package com.beaconremote.host

import android.content.Context
import android.content.Intent
import android.app.KeyguardManager
import android.hardware.display.DisplayManager
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import android.media.projection.MediaProjection
import android.os.SystemClock
import android.util.Log
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import org.webrtc.DataChannel
import org.webrtc.DefaultVideoDecoderFactory
import org.webrtc.DefaultVideoEncoderFactory
import org.webrtc.EglBase
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStreamTrack
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpTransceiver
import org.webrtc.ScreenCapturerAndroid
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoSource
import org.webrtc.VideoTrack

/**
 * One approved screen-sharing session: the signaling socket with its short authorization lease, the screen
 * capture, and the peer connection that carries the picture to the helper's browser.
 *
 * The lease works like the Windows helper's: this side sends a numbered challenge every second and the server
 * echoes it; sharing stops unless a reply to a challenge sent within the last three seconds arrives, so a
 * stalled or revoked session ends by itself. Everything runs on one thread, so no locking is needed.
 */
class ShareSession(
    private val context: Context,
    private val grant: Grant,
    private val server: String,
    private val projectionData: Intent?,
    /** The person chose to let the helper touch and type (and the accessibility service is on). */
    private val controlAllowed: Boolean = false,
    /** The person also allowed the helper to send files to this phone. */
    private val filesAllowed: Boolean = false,
    private val unattended: Boolean = false,
    private val onControl: (Boolean) -> Unit = {},
    private val onPermissionPrompt: ((LivePermissionPrompt?) -> Unit)? = null,
    private val onEnded: (String) -> Unit,
) {
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var socket: WebSocket? = null
    @Volatile private var ended = false
    private val viewer = ViewerConnection()
    private val permissions = LivePermissionRequest()
    private var permissionsVersion = 0
    private var advertised = emptySet<LivePermission>()
    private var dataTransportAvailable = false
    @Volatile private var paused = false

    // Lease bookkeeping, in SystemClock.elapsedRealtime milliseconds.
    private val started = SystemClock.elapsedRealtime()
    private var sequence = 0L
    private val challenges = ArrayDeque<Pair<String, Long>>()
    @Volatile private var lastLease = 0L
    private var ticker: ScheduledFuture<*>? = null

    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    private var capturer: org.webrtc.VideoCapturer? = null
    private var helper: SurfaceTextureHelper? = null
    private var peer: PeerConnection? = null
    private var control: RemoteControl? = null
    private var files: FileReceiver? = null
    private var screenWidth = 0
    private var screenHeight = 0
    private var displayListener: DisplayManager.DisplayListener? = null

    /** The screen's real size now, in pixels: it changes when the phone is turned. */
    private fun currentSize(): Pair<Int, Int> {
        val manager = context.getSystemService(DisplayManager::class.java)
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        manager.getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(metrics)
        return metrics.widthPixels to metrics.heightPixels
    }

    /** What is sent to the helper: at most 1280 on the long side, even numbers (the encoder needs them). */
    private fun captureSize(width: Int, height: Int): Pair<Int, Int> {
        val scale = minOf(1.0, 1280.0 / maxOf(width, height))
        return ((width * scale).toInt() / 2 * 2) to ((height * scale).toInt() / 2 * 2)
    }

    /** The phone was turned (or its resolution changed): resize the capture and the control mapping, and tell the viewer. */
    private fun screenChanged() {
        if (ended) return
        val (width, height) = currentSize()
        if (width == screenWidth && height == screenHeight) return
        screenWidth = width
        screenHeight = height
        val (captureWidth, captureHeight) = captureSize(width, height)
        runCatching { capturer?.changeCaptureFormat(captureWidth, captureHeight, 30) }
        control?.resize(width, height)
    }

    /** Callbacks from OkHttp and WebRTC can arrive after the session has shut its thread down; they are dropped. */
    private fun post(block: () -> Unit) {
        try {
            worker.execute(block)
        } catch (_: RejectedExecutionException) {
        }
    }

    /** Refuses the request without sharing anything. */
    fun decline() {
        post {
            connect(accepted = false)
        }
    }

    fun start() {
        post { connect(accepted = true) }
    }

    fun stop() {
        post {
            socket?.send(JSONObject().put("type", "stop").toString())
            end("Sharing stopped")
        }
    }

    /** Offers a file the person picked on this phone. [onResult] receives a reason when nothing was offered. */
    fun sendFile(uri: android.net.Uri, onResult: (String) -> Unit) = post {
        val receiver = files
        if (receiver == null) onResult("File sending is not available in this session.") else receiver.sendFile(uri, onResult)
    }

    /** Whether the notification should offer Send file now. Advisory: the transfer checks again when it starts. */
    fun canSendFile(): Boolean = files?.canSend() == true

    fun setPaused(value: Boolean) {
        post {
            paused = value
            if (value) control?.release()
            refreshVideo()
            refreshPermissionOptions()
            socket?.send(JSONObject().put("type", "paused").put("paused", value).toString())
        }
    }

    fun decidePermission(sessionId: String, id: String, generation: Long, allow: Boolean) {
        post {
            if (sessionId != grant.id) return@post
            val request = permissions.find(id, generation) ?: return@post
            val approved = allow && request.scope in availablePermissions(generation)
            val prompt = permissions.respond(id, generation, approved, SystemClock.elapsedRealtime()) ?: return@post
            onPermissionPrompt?.invoke(null)
            sendPermissionDecision(prompt, approved)
            refreshPermissionOptions()
        }
    }

    private fun availablePermissions(generation: Long): Set<LivePermission> {
        if (permissionsVersion != 1 || onPermissionPrompt == null || !canShare(generation) || !localActionsAllowed()) return emptySet()
        if (!deviceUnlocked()) return emptySet()
        return buildSet {
            if (!filesAllowed && files?.isOpen() == true && !permissions.allowed(generation, LivePermission.FILES)) add(LivePermission.FILES)
            if (dataTransportAvailable && control == null && ControlService.enabled(context) && ControlService.instance != null &&
                !permissions.allowed(generation, LivePermission.CONTROL)) add(LivePermission.CONTROL)
        }
    }

    private fun deviceUnlocked(): Boolean =
        context.getSystemService(KeyguardManager::class.java).let { !it.isDeviceLocked && !it.isKeyguardLocked }

    private fun refreshPermissionOptions() {
        val available = availablePermissions(viewer.generation)
        permissions.cancelIfUnavailable(SystemClock.elapsedRealtime(), available)?.let {
            onPermissionPrompt?.invoke(null)
            sendPermissionDecision(it, false)
        }
        if (!viewer.owns(viewer.generation) || available == advertised) return
        advertised = available
        socket?.send(JSONObject().put("type", "permission-options")
            .put("generation", viewer.generation)
            .put("scopes", org.json.JSONArray(available.map { it.wire })).toString())
    }

    private fun sendPermissionDecision(prompt: LivePermissionPrompt, approved: Boolean) {
        socket?.send(JSONObject().put("type", "permission-decision")
            .put("generation", prompt.generation).put("id", prompt.id).put("approved", approved).toString())
    }

    private fun connect(accepted: Boolean) {
        val url = server.replaceFirst("http", "ws") + "/api/sessions/${grant.id}/signal?role=machine"
        val request = Request.Builder().url(url).header("Authorization", "Bearer ${grant.token}").build()
        socket =
            Api.http.newWebSocket(
                request,
                object : WebSocketListener() {
                    override fun onOpen(webSocket: WebSocket, response: Response) {
                        post {
                            if (!accepted || !SharingNotifications.ready(context)) {
                                webSocket.send(JSONObject().put("type", "consent").put("accepted", false).toString())
                                end(if (accepted) "Sharing notifications are unavailable" else "Declined")
                                return@post
                            }
                            val consent = JSONObject().put("type", "consent").put("accepted", true).put("resumable", true)
                            // Control was asked for but not allowed: the viewer is told it is view only.
                            if (grant.capability == "desktop:control" && !controlAllowed) consent.put("control", false)
                            webSocket.send(consent.toString())
                            ticker = worker.scheduleAtFixedRate({ tick() }, 0, 1000, TimeUnit.MILLISECONDS)
                            runCatching { beginMedia() }.onFailure {
                                Log.w(TAG, "Screen capture could not start", it)
                                end("Could not start screen capture")
                            }
                        }
                    }

                    override fun onMessage(webSocket: WebSocket, text: String) {
                        post { runCatching { handle(JSONObject(text)) }.onFailure { Log.w(TAG, "Bad signaling message", it) } }
                    }

                    override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                        post { end("Connection closed") }
                    }

                    override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                        Log.w(TAG, "Signaling failed", t)
                        post { end("Connection lost") }
                    }
                },
            )
    }

    private fun tick() {
        if (ended) return
        if (!SharingNotifications.ready(context)) {
            socket?.send(JSONObject().put("type", "stop").toString())
            end("Sharing notifications are unavailable")
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (unattended && now - maxOf(started, control?.lastActivity ?: 0L, files?.lastActivity ?: 0L) >= 30 * 60 * 1000L) {
            end("Unattended session ended after 30 minutes without input")
            return
        }
        if (!Identity(context).wantsAvailable || (unattended && (!Identity(context).unattended || !UnattendedAccess.ready(context)))) {
            end("Unattended access was turned off or the phone was locked")
            return
        }
        // Authorization lapses without a fresh reply: nothing keeps sharing on its own.
        if (now - started >= MAX_AGE && (lastLease == 0L || now - lastLease >= MAX_AGE)) {
            end("Authorization lapsed")
            return
        }
        control?.quietCheck()
        refreshPermissionOptions()
        sequence += 1
        challenges.addLast(sequence.toString() to now)
        while (challenges.size > 4) challenges.removeFirst()
        socket?.send(JSONObject().put("type", "renew").put("nonce", sequence.toString()).toString())
    }

    private fun handle(message: JSONObject) {
        if (ended) return
        when (message.optString("type")) {
            "joined" -> permissionsVersion = message.optInt("permissionsVersion")
            "permission-prompt" -> {
                if (permissionsVersion != 1) return
                val scope = LivePermission.entries.firstOrNull { it.wire == message.optString("scope") } ?: return
                val generation = message.optLong("generation", -1)
                val id = message.optString("id")
                if (runCatching { UUID.fromString(id).toString() }.getOrNull() != id) return
                val prompt = LivePermissionPrompt(grant.id, id, generation, message.optLong("timeoutMs"), scope)
                if (scope !in availablePermissions(generation) || !permissions.begin(prompt, SystemClock.elapsedRealtime())) {
                    sendPermissionDecision(prompt, false)
                    return
                }
                onPermissionPrompt?.invoke(prompt)
            }
            "permission-dismiss" -> {
                if (permissions.cancel(message.optString("id"), message.optLong("generation", -1))) onPermissionPrompt?.invoke(null)
            }
            "permission-commit" -> {
                val generation = message.optLong("generation", -1)
                val id = message.optString("id")
                val prompt = permissions.find(id, generation)
                if (prompt == null) {
                    Log.w("BeaconHost", "Permission commit for an unknown or expired request")
                    return
                }
                val stillAvailable = prompt.scope in availablePermissions(generation)
                Log.i("BeaconHost", "Permission commit for ${prompt.scope.wire}: available=$stillAvailable")
                if (stillAvailable &&
                    permissions.commit(id, generation, SystemClock.elapsedRealtime())) {
                    when (prompt.scope) {
                        LivePermission.FILES -> files?.publishReady()
                        LivePermission.CONTROL -> openInput(generation, "beacon-approved-input-v1:$id") {
                            permissions.allowed(generation, LivePermission.CONTROL) && deviceUnlocked()
                        }
                    }
                    refreshPermissionOptions()
                }
            }
            "lease" -> {
                val nonce = message.optString("nonce")
                val entry = challenges.firstOrNull { it.first == nonce } ?: return
                challenges.remove(entry)
                if (SystemClock.elapsedRealtime() - entry.second < MAX_AGE) {
                    lastLease = maxOf(lastLease, entry.second)
                    refreshVideo()
                    refreshPermissionOptions()
                }
            }
            "answer" -> {
                if (!viewer.owns(message.optLong("generation", 0))) return
                peer?.setRemoteDescription(
                    object : SimpleSdpObserver() {},
                    SessionDescription(SessionDescription.Type.ANSWER, message.getString("sdp")),
                )
            }
            "candidate" -> {
                if (!viewer.owns(message.optLong("generation", 0))) return
                peer?.addIceCandidate(
                    IceCandidate(
                        if (message.isNull("sdpMid")) "" else message.getString("sdpMid"),
                        message.optInt("sdpMLineIndex", 0),
                        message.getString("candidate"),
                    ),
                )
            }
            "viewer-detached" -> {
                // Nothing is sent while nobody is watching; the capture keeps its place for a quick return.
                viewer.detach()
                closePeer()
            }
            "viewer-resumed" -> {
                if (viewer.resume(message.optLong("generation", -1))) openPeer()
            }
            "ended" -> end("Ended")
        }
    }

    private fun beginMedia() {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).setEnableInternalTracer(false).createInitializationOptions(),
        )
        val eglBase = EglBase.create().also { egl = it }
        val peerFactory =
            PeerConnectionFactory.builder()
                .setVideoEncoderFactory(DefaultVideoEncoderFactory(eglBase.eglBaseContext, true, true))
                .setVideoDecoderFactory(DefaultVideoDecoderFactory(eglBase.eglBaseContext))
                .createPeerConnectionFactory()
                .also { factory = it }
        val videoSource = peerFactory.createVideoSource(true).also { source = it }
        track = peerFactory.createVideoTrack("beacon-screen", videoSource).also { it.setEnabled(false) }
        val surfaces = SurfaceTextureHelper.create("screen-capture", eglBase.eglBaseContext).also { helper = it }
        val projection = if (unattended && android.os.Build.VERSION.SDK_INT >= 30) {
            AccessibilityCapturer(context, {
                canShare(viewer.generation)
            }, { reason -> post { end(reason) } })
        } else {
            ScreenCapturerAndroid(
                projectionData ?: error("No capture permission"),
                object : MediaProjection.Callback() {
                    override fun onStop() {
                        post { end("Screen capture was stopped") }
                    }
                },
            )
        }
        capturer = projection
        projection.initialize(surfaces, context, videoSource.capturerObserver)
        val (realWidth, realHeight) = currentSize()
        screenWidth = realWidth
        screenHeight = realHeight
        val (width, height) = captureSize(realWidth, realHeight)
        projection.startCapture(width, height, 30)
        val listener =
            object : DisplayManager.DisplayListener {
                override fun onDisplayAdded(displayId: Int) {}

                override fun onDisplayRemoved(displayId: Int) {}

                override fun onDisplayChanged(displayId: Int) {
                    if (displayId == Display.DEFAULT_DISPLAY) post { screenChanged() }
                }
            }
        displayListener = listener
        context.getSystemService(DisplayManager::class.java).registerDisplayListener(listener, Handler(Looper.getMainLooper()))
        openPeer()
    }

    private fun openPeer() {
        closePeer()
        val peerFactory = factory ?: return
        val servers =
            (0 until grant.iceServers.length()).map { index ->
                val entry = grant.iceServers.getJSONObject(index)
                // The server sends one URL as a string and several as an array.
                val urls = entry.optJSONArray("urls")?.let { list -> (0 until list.length()).map { list.getString(it) } }
                    ?: listOf(entry.getString("urls"))
                PeerConnection.IceServer.builder(urls)
                    .also {
                        if (entry.has("username")) it.setUsername(entry.getString("username"))
                        if (entry.has("credential")) it.setPassword(entry.getString("credential"))
                    }
                    .createIceServer()
            }
        val configuration =
            PeerConnection.RTCConfiguration(servers).apply {
                sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
                // Video and optional control/files share one ICE transport;
                // gathering each separately can exhaust a bounded TURN session.
                bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
                if (grant.relayOnly) iceTransportsType = PeerConnection.IceTransportsType.RELAY
            }
        val thisGeneration = viewer.generation
        val connection =
            peerFactory.createPeerConnection(
                configuration,
                object : PeerConnection.Observer {
                    override fun onIceCandidate(candidate: IceCandidate) {
                        post {
                            if (!viewer.owns(thisGeneration)) return@post
                            socket?.send(
                                JSONObject()
                                    .put("type", "candidate")
                                    .put("candidate", candidate.sdp)
                                    .put("sdpMid", candidate.sdpMid)
                                    .put("sdpMLineIndex", candidate.sdpMLineIndex)
                                    .put("generation", thisGeneration)
                                    .toString(),
                            )
                        }
                    }

                    override fun onSignalingChange(state: PeerConnection.SignalingState) {}
                    override fun onConnectionChange(state: PeerConnection.PeerConnectionState) {
                        post {
                            val connected = state == PeerConnection.PeerConnectionState.CONNECTED
                            if (!viewer.connectionChanged(thisGeneration, connected)) return@post
                            if (!connected) control?.release()
                            refreshVideo()
                            refreshPermissionOptions()
                        }
                    }
                    override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
                    override fun onIceConnectionReceivingChange(receiving: Boolean) {}
                    override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
                    override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
                    override fun onAddStream(stream: org.webrtc.MediaStream) {}
                    override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
                    override fun onDataChannel(channel: org.webrtc.DataChannel) {}
                    override fun onRenegotiationNeeded() {}
                    override fun onAddTrack(receiver: org.webrtc.RtpReceiver, streams: Array<out org.webrtc.MediaStream>) {}
                },
            ) ?: return
        peer = connection
        val screen = track ?: return
        val sender = connection.addTrack(screen, listOf("beacon-screen"))
        connection.transceivers.firstOrNull { it.sender == sender }?.direction = RtpTransceiver.RtpTransceiverDirection.SEND_ONLY
        // Hardware H.264 first where the phone has it; the browser picks what both sides support.
        runCatching {
            val codecs = peerFactory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs
            val ordered = codecs.filter { it.name == "H264" } + codecs.filter { it.name != "H264" }
            connection.transceivers.firstOrNull { it.sender == sender }?.setCodecPreferences(ordered)
        }
        if (grant.capability == "desktop:control" && controlAllowed && ControlService.instance != null) {
            // The input channel is made here, before the offer, as the Windows host does.
            openInput(thisGeneration, "beacon-input-v1") { true }
        }
        // Negotiate SCTP with the first offer so an approved input lane can open later.
        if (filesAllowed || onPermissionPrompt != null) {
            connection.createDataChannel("beacon-files-v1", DataChannel.Init().apply { ordered = true })?.let { channel ->
                dataTransportAvailable = true
                if (FileReceiver.supported) {
                    val permitted = { filesAllowed || permissions.allowed(thisGeneration, LivePermission.FILES) }
                    files = FileReceiver(context, channel, permitted) {
                        permitted() && canShare(thisGeneration) && localActionsAllowed()
                    }.also { it.start() }
                }
            }
        }
        connection.createOffer(
            object : SimpleSdpObserver() {
                override fun onCreateSuccess(description: SessionDescription) {
                    post {
                        if (!viewer.owns(thisGeneration)) return@post
                        connection.setLocalDescription(
                            object : SimpleSdpObserver() {
                                override fun onSetSuccess() {
                                    post {
                                        if (viewer.owns(thisGeneration)) {
                                            socket?.send(
                                                JSONObject()
                                                    .put("type", "offer")
                                                    .put("sdp", description.description)
                                                    .put("generation", thisGeneration)
                                                    .toString(),
                                            )
                                        }
                                    }
                                }
                            },
                            description,
                        )
                    }
                }
            },
            MediaConstraints(),
        )
    }

    private fun openInput(generation: Long, label: String, permitted: () -> Boolean) {
        if (control != null) {
            Log.w("BeaconHost", "Input channel not opened: control is already active")
            return
        }
        val channel = peer?.createDataChannel(label, DataChannel.Init().apply { ordered = true })
        if (channel == null) {
            Log.w("BeaconHost", "Input channel not opened: no peer connection")
            return
        }
        Log.i("BeaconHost", "Input channel opened for an approved control request")
        control = RemoteControl(channel, grant.id, screenWidth, screenHeight, {
            permitted() && canShare(generation) && localActionsAllowed()
        }) { active -> post { if (viewer.owns(generation)) onControl(active) } }.also { it.start() }
    }

    private fun localActionsAllowed(): Boolean = Identity(context).let { identity ->
        identity.wantsAvailable && if (unattended) {
            identity.unattended && UnattendedAccess.ready(context)
        } else {
            SharingNotifications.ready(context)
        }
    }

    private fun canShare(generation: Long): Boolean =
        !paused && !ended && viewer.connected(generation) &&
            lastLease != 0L && SystemClock.elapsedRealtime() - lastLease < MAX_AGE

    private fun refreshVideo() {
        track?.setEnabled(canShare(viewer.generation) && localActionsAllowed())
    }

    private fun closePeer() {
        permissions.detach()
        advertised = emptySet()
        dataTransportAvailable = false
        onPermissionPrompt?.invoke(null)
        track?.setEnabled(false)
        control?.stop()
        control = null
        onControl(false)
        files?.stop()
        files = null
        peer?.let {
            runCatching { it.close() }
            runCatching { it.dispose() }
        }
        peer = null
    }

    private fun end(reason: String) {
        if (ended) return
        Log.i(TAG, "Session ended: $reason")
        ended = true
        viewer.detach()
        displayListener?.let { runCatching { context.getSystemService(DisplayManager::class.java).unregisterDisplayListener(it) } }
        ticker?.cancel(false)
        runCatching { socket?.close(1000, null) }
        closePeer()
        runCatching { capturer?.stopCapture() }
        runCatching { capturer?.dispose() }
        runCatching { helper?.dispose() }
        runCatching { track?.dispose() }
        runCatching { source?.dispose() }
        runCatching { factory?.dispose() }
        runCatching { egl?.release() }
        onEnded(reason)
        worker.shutdown()
    }

    private open class SimpleSdpObserver : SdpObserver {
        override fun onCreateSuccess(description: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String?) {}
        override fun onSetFailure(error: String?) {}
    }

    private companion object {
        const val MAX_AGE = 3000L
        const val TAG = "BeaconHost"
    }
}

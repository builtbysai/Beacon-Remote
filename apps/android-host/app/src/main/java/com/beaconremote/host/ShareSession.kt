package com.beaconremote.host

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.os.SystemClock
import android.util.Log
import java.util.ArrayDeque
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
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
    private val onEnded: (String) -> Unit,
) {
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private var socket: WebSocket? = null
    private var ended = false
    private var generation = 0L
    private var paused = false

    // Lease bookkeeping, in SystemClock.elapsedRealtime milliseconds.
    private val started = SystemClock.elapsedRealtime()
    private var sequence = 0L
    private val challenges = ArrayDeque<Pair<String, Long>>()
    private var lastLease = 0L
    private var ticker: ScheduledFuture<*>? = null

    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var helper: SurfaceTextureHelper? = null
    private var peer: PeerConnection? = null

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

    fun setPaused(value: Boolean) {
        post {
            paused = value
            track?.setEnabled(!value)
            socket?.send(JSONObject().put("type", "paused").put("paused", value).toString())
        }
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
                            if (!accepted) {
                                webSocket.send(JSONObject().put("type", "consent").put("accepted", false).toString())
                                end("Declined")
                                return@post
                            }
                            webSocket.send(
                                JSONObject().put("type", "consent").put("accepted", true).put("resumable", true).toString(),
                            )
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
        val now = SystemClock.elapsedRealtime()
        // Authorization lapses without a fresh reply: nothing keeps sharing on its own.
        if (now - started >= MAX_AGE && (lastLease == 0L || now - lastLease >= MAX_AGE)) {
            end("Authorization lapsed")
            return
        }
        sequence += 1
        challenges.addLast(sequence.toString() to now)
        while (challenges.size > 4) challenges.removeFirst()
        socket?.send(JSONObject().put("type", "renew").put("nonce", sequence.toString()).toString())
    }

    private fun handle(message: JSONObject) {
        if (ended) return
        when (message.optString("type")) {
            "lease" -> {
                val nonce = message.optString("nonce")
                val entry = challenges.firstOrNull { it.first == nonce } ?: return
                challenges.remove(entry)
                if (SystemClock.elapsedRealtime() - entry.second < MAX_AGE) lastLease = maxOf(lastLease, entry.second)
            }
            "answer" -> {
                if (message.optLong("generation", 0) != generation) return
                peer?.setRemoteDescription(
                    object : SimpleSdpObserver() {},
                    SessionDescription(SessionDescription.Type.ANSWER, message.getString("sdp")),
                )
            }
            "candidate" -> {
                if (message.optLong("generation", 0) != generation) return
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
                closePeer()
            }
            "viewer-resumed" -> {
                generation = message.optLong("generation", generation + 1)
                openPeer()
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
        track = peerFactory.createVideoTrack("beacon-screen", videoSource)
        val surfaces = SurfaceTextureHelper.create("screen-capture", eglBase.eglBaseContext).also { helper = it }
        val projection =
            ScreenCapturerAndroid(
                projectionData ?: error("No capture permission"),
                object : MediaProjection.Callback() {
                    override fun onStop() {
                        post { end("Screen capture was stopped") }
                    }
                },
            )
        capturer = projection
        projection.initialize(surfaces, context, videoSource.capturerObserver)
        val metrics = context.resources.displayMetrics
        val scale = minOf(1.0, 1280.0 / maxOf(metrics.widthPixels, metrics.heightPixels))
        val width = ((metrics.widthPixels * scale).toInt() / 2) * 2
        val height = ((metrics.heightPixels * scale).toInt() / 2) * 2
        projection.startCapture(width, height, 30)
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
                if (grant.relayOnly) iceTransportsType = PeerConnection.IceTransportsType.RELAY
            }
        val thisGeneration = generation
        val connection =
            peerFactory.createPeerConnection(
                configuration,
                object : PeerConnection.Observer {
                    override fun onIceCandidate(candidate: IceCandidate) {
                        post {
                            if (thisGeneration != generation) return@post
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
        screen.setEnabled(!paused)
        val sender = connection.addTrack(screen, listOf("beacon-screen"))
        connection.transceivers.firstOrNull { it.sender == sender }?.direction = RtpTransceiver.RtpTransceiverDirection.SEND_ONLY
        // Hardware H.264 first where the phone has it; the browser picks what both sides support.
        runCatching {
            val codecs = peerFactory.getRtpSenderCapabilities(MediaStreamTrack.MediaType.MEDIA_TYPE_VIDEO).codecs
            val ordered = codecs.filter { it.name == "H264" } + codecs.filter { it.name != "H264" }
            connection.transceivers.firstOrNull { it.sender == sender }?.setCodecPreferences(ordered)
        }
        connection.createOffer(
            object : SimpleSdpObserver() {
                override fun onCreateSuccess(description: SessionDescription) {
                    connection.setLocalDescription(
                        object : SimpleSdpObserver() {
                            override fun onSetSuccess() {
                                post {
                                    if (thisGeneration != generation) return@post
                                    socket?.send(
                                        JSONObject()
                                            .put("type", "offer")
                                            .put("sdp", description.description)
                                            .put("generation", thisGeneration)
                                            .toString(),
                                    )
                                }
                            }
                        },
                        description,
                    )
                }
            },
            MediaConstraints(),
        )
    }

    private fun closePeer() {
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

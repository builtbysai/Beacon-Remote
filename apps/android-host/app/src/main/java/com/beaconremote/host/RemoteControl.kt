package com.beaconremote.host

import android.os.SystemClock
import android.util.Log
import java.nio.ByteBuffer
import org.json.JSONObject
import org.webrtc.DataChannel

/**
 * The phone's side of the `beacon-input-v1` channel (ADR 0036). The viewer sends the same bounded envelopes it sends
 * a Windows computer: a session and lease id, a rising sequence, and one input. Anything malformed ends control (the
 * session itself carries on, view only). While [allowed] says no (paused, ended) nothing is injected.
 */
class RemoteControl(
    private val channel: DataChannel,
    private val sessionId: String,
    width: Int,
    height: Int,
    private val allowed: () -> Boolean,
    /** Offers a copied file to the viewer through the files channel (the viewer saves it as a download). */
    private val offerFile: (android.net.Uri) -> Unit = {},
    /** Opens or closes the viewer's voice on the phone's speaker; returns what happened: on, off, locked or disabled. */
    private val onTalk: (Boolean) -> String = { "disabled" },
    private val onState: (Boolean) -> Unit,
) : DataChannel.Observer {
    private var talking = false
    // Whether the phone is locked, told to the viewer whenever it changes (so Unlock appears only at the lock screen).
    private var lastLocked: Boolean? = null
    // The screen's size in pixels; changes when the phone is turned (see [resize]).
    private var width = width
    private var height = height
    private var lastSequence = -1L
    private var windowStart = SystemClock.elapsedRealtime()
    private var count = 0
    private var lastMessage = SystemClock.elapsedRealtime()
    @Volatile var lastActivity: Long = 0L
        private set
    private var pointerX = width / 2
    private var pointerY = height / 2
    @Volatile private var down = false
    @Volatile private var touch: NativeTouchStream? = null
    private var lastScroll = 0L
    private var shift = false
    private var capsLock = false
    private var modified = false
    @Volatile private var open = false
    // Passcode keys are pressed one at a time on their own thread, because finding the PIN screen can take a moment.
    private val lockKeys = java.util.concurrent.Executors.newSingleThreadExecutor()
    // While the viewer shows its stand-in for the PIN screen, the screen's layout is sent about once a second.
    private var lockView: java.util.concurrent.ScheduledExecutorService? = null
    private var lastSwipe = 0L

    private fun lockScreenView(on: Boolean) {
        lockView?.shutdownNow()
        lockView = null
        if (!on) return
        lockView = java.util.concurrent.Executors.newSingleThreadScheduledExecutor().also { scheduler ->
            scheduler.scheduleWithFixedDelay({
                runCatching {
                    val service = ControlService.instance ?: return@runCatching
                    val snapshot = service.lockScreenSnapshot()
                    if (open) sendJson(snapshot)
                    // The PIN screen is not up yet: bring it up, but not more than once every few seconds.
                    if (snapshot.optString("state") == "no-pad" && SystemClock.elapsedRealtime() - lastSwipe > 5000) {
                        lastSwipe = SystemClock.elapsedRealtime()
                        service.swipeUpToPin()
                    }
                }
            }, 0, 900, java.util.concurrent.TimeUnit.MILLISECONDS)
        }
    }
    // Clipboard sharing (ADR 0021 as amended): text only, gated by the phone's own setting, never rich formats yet.
    private val clipboardParts = StringBuilder()
    private val clipboardHtml = StringBuilder()
    private val clipboardImage = StringBuilder()
    private var stopClipboardListener: (() -> Unit)? = null
    private var lastClipboard = ""

    private fun clipboardMode(): String = ControlService.instance?.let { Identity(it).clipboardMode } ?: "off"

    private fun sendJson(message: JSONObject) {
        channel.send(DataChannel.Buffer(ByteBuffer.wrap(message.toString().toByteArray()), false))
    }

    /** Tells the viewer what the phone's clipboard setting is, and starts watching for copies when it is automatic. */
    private fun announceClipboard() {
        sendJson(JSONObject().put("type", "clipboard_mode").put("mode", clipboardMode()))
        stopClipboardListener?.invoke()
        stopClipboardListener = ControlService.instance?.listenForClipboard { onClipboardChanged() }
    }

    /** If the phone's clipboard holds an image, sends it in paced pieces after the text reply. Runs off the input thread. */
    /** Answers a viewer's copy request. Runs off the input thread, because reading may need a moment on screen. */
    private fun answerClipboardRead(service: ControlService, mode: String) {
        var text: String? = null
        var html: String? = null
        var image: Pair<String, ByteArray>? = null
        var file: android.net.Uri? = null
        if (mode != "off") {
            text = service.readClipboardText()
            html = service.readClipboardHtml()
            image = service.readClipboardImage(MAX_CLIPBOARD_IMAGE)
            if (text.isNullOrEmpty() && image == null) file = service.readClipboardFile()
            if (text.isNullOrEmpty() && image == null && file == null) {
                // Android refused a background read: bring an invisible screen forward for a moment and read there.
                service.readClipboardViaActivity()?.let { snapshot ->
                    text = snapshot.text
                    html = snapshot.html
                    if (snapshot.image != null && snapshot.imageMime != null) image = snapshot.imageMime to snapshot.image
                    file = snapshot.file
                }
            }
        }
        val readText = text
        Log.i(TAG, "Clipboard read requested (mode $mode): ${readText?.length?.let { "returned $it characters" } ?: if (image != null) "an image" else "unavailable"}")
        val reply =
            if (readText.isNullOrEmpty()) {
                JSONObject().put("type", "clipboard").put("text", "").put("truncated", false).put("unavailable", image == null && file == null)
                    .put("file", file != null)
            } else {
                lastClipboard = readText
                JSONObject().put("type", "clipboard").put("text", readText.take(MAX_CLIPBOARD_CHARS))
                    .put("truncated", readText.length > MAX_CLIPBOARD_CHARS).put("unavailable", false)
                    .also { out -> html?.takeIf { it.length <= MAX_CLIPBOARD_HTML }?.let { out.put("html", it) } }
            }
        sendJson(reply)
        image?.let { (mime, bytes) -> streamClipboardImage(mime, bytes) }
        file?.let { offerFile(it) }
    }

    /** Sends an image in paced pieces after the text reply. */
    private fun streamClipboardImage(mime: String, bytes: ByteArray) {
        val encoded = android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
        sendJson(JSONObject().put("type", "clipboard_image_start").put("mime", mime).put("size", bytes.size))
        var at = 0
        while (at < encoded.length && open) {
            val end = minOf(encoded.length, at + 1000)
            sendJson(JSONObject().put("type", "clipboard_image").put("text", encoded.substring(at, end)).put("more", end < encoded.length))
            at = end
            Thread.sleep(5)
        }
        Log.i(TAG, "Clipboard image sent to the viewer: ${bytes.size} bytes")
    }

    private fun onClipboardChanged() {
        if (!open || clipboardMode() != "auto") return
        val text = ControlService.instance?.readClipboardText()?.takeIf { it.isNotEmpty() } ?: return
        if (text == lastClipboard) return
        lastClipboard = text
        sendJson(
            JSONObject().put("type", "clipboard").put("text", text.take(MAX_CLIPBOARD_CHARS))
                .put("truncated", text.length > MAX_CLIPBOARD_CHARS).put("unavailable", false)
                .also { reply -> ControlService.instance?.readClipboardHtml()?.takeIf { it.length <= MAX_CLIPBOARD_HTML }?.let { reply.put("html", it) } },
        )
    }

    fun start() {
        channel.registerObserver(this)
        // The channel can already be open before the observer is registered; no change event follows then.
        onStateChange()
    }

    override fun onBufferedAmountChange(previous: Long) {}

    @Synchronized
    override fun onStateChange() {
        val state = channel.state()
        Log.i("BeaconHost", "Input channel state: $state")
        when (state) {
            DataChannel.State.OPEN -> {
                if (open) return
                open = true
                lastMessage = SystemClock.elapsedRealtime()
                sendGeometry()
                onState(true)
            }
            DataChannel.State.CLOSED, DataChannel.State.CLOSING -> stop()
            else -> {}
        }
    }

    private fun sendGeometry() {
        val geometry = JSONObject().put("type", "display").put("id", "0").put("width", width).put("height", height).put("platform", "android")
        channel.send(DataChannel.Buffer(ByteBuffer.wrap(geometry.toString().toByteArray()), false))
    }

    /** The screen changed size (the phone was turned): later input is mapped to the new size, and the viewer is told. */
    fun resize(newWidth: Int, newHeight: Int) {
        if (newWidth == width && newHeight == height) return
        width = newWidth
        height = newHeight
        pointerX = pointerX.coerceIn(0, width - 1)
        pointerY = pointerY.coerceIn(0, height - 1)
        release()
        if (open) sendGeometry()
    }

    override fun onMessage(buffer: DataChannel.Buffer) {
        val now = SystemClock.elapsedRealtime()
        if (buffer.binary || buffer.data.remaining() > MAX_MESSAGE) return fail("input was not a small text message")
        if (now - windowStart >= 1000) {
            windowStart = now
            count = 0
        }
        if (++count > MAX_PER_SECOND) return fail("too much input")
        lastMessage = now
        val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
        val body =
            try {
                JSONObject(String(bytes))
            } catch (error: Exception) {
                return fail("input was not valid")
            }
        val sequence = body.optLong("sequence", -1)
        if (body.optInt("version") != 1 || body.optString("sessionId") != sessionId || body.optString("leaseId") != sessionId || sequence <= lastSequence) {
            return fail("input did not belong to this session")
        }
        lastSequence = sequence
        val input = body.optJSONObject("input") ?: return fail("input was missing")
        if (!allowed()) {
            release()
            return
        }
        try {
            apply(input)
            if (input.optString("type") != "keep_alive") lastActivity = now
        } catch (error: Exception) {
            Log.w(TAG, "Ignored input", error)
        }
    }

    /** Called about once a second by the session: held touches are let go when the viewer goes quiet. */
    fun quietCheck() {
        val quiet = SystemClock.elapsedRealtime() - lastMessage
        val locked = ControlService.instance?.let { it.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked }
        if (locked != null && locked != lastLocked) {
            lastLocked = locked
            runCatching { sendJson(JSONObject().put("type", "lock").put("locked", locked)) }
        }
        // Talking stops the moment the phone locks.
        if (talking && ControlService.instance?.let { it.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked } == true) setTalk(false)
        if (open && quiet >= 1500) release()
        if (open && quiet >= 30_000) stop()
    }

    fun release() {
        val wasDown = down
        down = false
        // Older viewers send release_all after a normal mouse-up. Keep that
        // completed click, but cancel any contact whose button is still down.
        if (wasDown) touch?.cancel()
        shift = false
        modified = false
    }

    private fun setTalk(on: Boolean) {
        val state = runCatching { onTalk(on) }.getOrDefault("disabled")
        talking = state == "on"
        runCatching { sendJson(JSONObject().put("type", "talk").put("state", state)) }
    }

    fun stop() {
        val wasOpen = open
        open = false
        release()
        touch?.close()
        touch = null
        if (!wasOpen) return
        if (talking) runCatching { onTalk(false) }
        talking = false
        Chat.send = null
        runCatching { ControlService.instance?.clearClipboardImages() }
        runCatching { lockKeys.shutdownNow() }
        lockScreenView(false)
        runCatching { stopClipboardListener?.invoke() }
        stopClipboardListener = null
        runCatching { channel.unregisterObserver() }
        runCatching { channel.close() }
        onState(false)
    }

    private fun fail(reason: String) {
        Log.w(TAG, "Control ended: $reason")
        stop()
    }

    private fun apply(input: JSONObject) {
        val service = ControlService.instance ?: return
        when (input.optString("type")) {
            "move_pointer" -> {
                pointerX = input.getInt("x").coerceIn(0, width - 1)
                pointerY = input.getInt("y").coerceIn(0, height - 1)
                if (down) touch?.move(pointerX, pointerY)
            }
            "button" -> {
                val isDown = input.getBoolean("down")
                when (input.getString("button")) {
                    "left" -> if (isDown && !down) {
                        val stream = touch ?: NativeTouchStream(service, { open && allowed() },
                            { release() }, { fail("Android refused touch dispatch") }).also { touch = it }
                        down = stream.press(pointerX, pointerY)
                        if (!down) fail("Touch input is unavailable")
                    } else if (down) {
                        if (!isDown) {
                            down = false
                            touch?.lift(pointerX, pointerY)
                        }
                    }
                    // A mouse's right button is Back on Android.
                    "right" -> if (isDown) service.system("back")
                }
            }
            "scroll" -> scroll(service, input.optInt("horizontal"), input.optInt("vertical"))
            "key" -> key(service, input.getInt("scanCode"), input.getBoolean("extended"), input.getBoolean("down"))
            "type_text" -> service.type(input.getString("text"))
            "nav" -> service.system(input.getString("action"))
            "clipboard_read" -> {
                val mode = clipboardMode()
                runCatching { lockKeys.execute { runCatching { answerClipboardRead(service, mode) } } }
            }
            "clipboard_write" -> {
                // The viewer sends its clipboard in small pieces (the channel carries 2 KB at most). Off ignores it.
                if (clipboardMode() == "off") {
                    clipboardParts.setLength(0)
                    return
                }
                val piece = input.getString("text")
                if (input.optString("kind") == "image") {
                    // An image arrives as base64 pieces and is written once the last one is in.
                    if (clipboardImage.length + piece.length > MAX_CLIPBOARD_IMAGE_BASE64) {
                        clipboardImage.setLength(0)
                        return
                    }
                    clipboardImage.append(piece)
                    if (!input.optBoolean("more")) {
                        val encoded = clipboardImage.toString()
                        clipboardImage.setLength(0)
                        val bytes = runCatching { android.util.Base64.decode(encoded, android.util.Base64.DEFAULT) }.getOrNull()
                        if (bytes != null && bytes.isNotEmpty() && service.writeClipboardImage(bytes, input.optString("mime", "image/png"))) {
                            Log.i(TAG, "Clipboard image written from the viewer: ${bytes.size} bytes")
                        }
                    }
                    return
                }
                if (input.optString("kind") == "html") {
                    // Formatted text arrives first, then the plain text that completes the write.
                    if (clipboardHtml.length + piece.length > MAX_CLIPBOARD_HTML) clipboardHtml.setLength(0) else clipboardHtml.append(piece)
                    return
                }
                if (clipboardParts.length + piece.length > MAX_CLIPBOARD_WRITE) {
                    clipboardParts.setLength(0)
                    clipboardHtml.setLength(0)
                    return
                }
                clipboardParts.append(piece)
                if (!input.optBoolean("more")) {
                    val text = clipboardParts.toString()
                    val html = clipboardHtml.toString()
                    clipboardParts.setLength(0)
                    clipboardHtml.setLength(0)
                    if (text.isNotEmpty() && service.writeClipboardText(text, html)) {
                        lastClipboard = text
                        Log.i(TAG, "Clipboard written from the viewer: ${text.length} characters")
                    }
                }
            }
            // A viewer that knows about the clipboard says so; older viewers never hear about it.
            "clipboard_hello" -> announceClipboard()
            "unlock_view" -> lockScreenView(input.optBoolean("on"))
            "talk" -> setTalk(input.optBoolean("on"))
            "unlock_pattern" -> {
                val list = input.optJSONArray("cells")
                val cells = if (list == null || list.length() > 9) null else (0 until list.length()).map { list.optInt(it, -1) }
                if (cells != null) runCatching { lockKeys.execute { sendJson(JSONObject().put("type", "unlock").put("state", runCatching { service.drawLockPattern(cells) }.getOrDefault("error"))) } }
            }
            "unlock_password" -> {
                val text = input.optString("text")
                if (text.isNotEmpty() && text.length <= 64) runCatching { lockKeys.execute { sendJson(JSONObject().put("type", "unlock").put("state", runCatching { service.enterLockPassword(text) }.getOrDefault("error"))) } }
            }
            "unlock_key" -> {
                val key = input.getString("key")
                if (key.length == 1 && key[0] in '0'..'9' || key == "delete" || key == "enter") {
                    // Nothing here logs or keeps the key. Only the outcome goes back, so the viewer can say what happened.
                    runCatching { lockKeys.execute { sendJson(JSONObject().put("type", "unlock").put("state", runCatching { service.pressLockKey(key) }.getOrDefault("error"))) } }
                }
            }
            "chat" -> {
                val text = input.getString("text").trim().take(Chat.MAX_CHARS)
                if (text.isNotEmpty()) {
                    Chat.send = { reply -> runCatching { sendJson(JSONObject().put("type", "chat").put("text", reply)) }.isSuccess }
                    Chat.show(service, text)
                }
            }
            "release_all" -> release()
            "keep_alive" -> {}
        }
    }

    private fun scroll(service: ControlService, horizontal: Int, vertical: Int) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastScroll < 120 || (horizontal == 0 && vertical == 0)) return
        lastScroll = now
        // Wheel up (positive) shows what is above, which on a touch screen is a finger moving down.
        val travelY = if (vertical == 0) 0 else Integer.signum(vertical) * kotlin.math.abs(vertical).coerceIn(120, height / 2)
        // Wheel right shows what is to the right: a finger moving left.
        val travelX = if (horizontal == 0) 0 else -Integer.signum(horizontal) * kotlin.math.abs(horizontal).coerceIn(120, width / 2)
        val startX = (pointerX - travelX / 2).coerceIn(0, width - 1)
        val startY = (pointerY - travelY / 2).coerceIn(0, height - 1)
        val endX = (pointerX + travelX / 2).coerceIn(0, width - 1)
        val endY = (pointerY + travelY / 2).coerceIn(0, height - 1)
        service.stroke(listOf(startX to startY, endX to endY), 160)
    }

    private fun key(service: ControlService, scan: Int, extended: Boolean, isDown: Boolean) {
        when {
            // Modifiers: Shift changes what a key types; Ctrl, Alt and the Windows key turn it into a shortcut, which is dropped.
            !extended && (scan == 0x2a || scan == 0x36) -> shift = isDown
            scan == 0x1d || scan == 0x38 || (extended && (scan == 0x5b || scan == 0x5c)) -> modified = isDown
            !isDown -> {}
            !extended && scan == 0x3a -> capsLock = !capsLock
            modified -> {}
            !extended && scan == 0x0e -> service.backspace()
            scan == 0x1c -> service.enter()
            extended && scan == 0x47 -> service.system("home")
            extended && scan == 0x48 -> scroll(service, 0, 240)
            extended && scan == 0x50 -> scroll(service, 0, -240)
            extended && scan == 0x49 -> scroll(service, 0, height / 2)
            extended && scan == 0x51 -> scroll(service, 0, -height / 2)
            extended && scan == 0x4b -> scroll(service, -240, 0)
            extended && scan == 0x4d -> scroll(service, 240, 0)
            !extended -> character(scan)?.let { service.type(it.toString()) }
        }
    }

    /** The US-layout character for a key's scan code, with Shift and Caps Lock applied. */
    private fun character(scan: Int): Char? {
        val base = LETTER_ROWS.firstNotNullOfOrNull { (first, letters) -> if (scan in first until first + letters.length) letters[scan - first] else null }
        if (base != null) return if (shift xor capsLock) base.uppercaseChar() else base
        val index = DIGITS.indexOf(scan)
        if (index >= 0) return if (shift) SHIFTED_DIGITS[index] else "1234567890"[index]
        PUNCTUATION[scan]?.let { return if (shift) it.second else it.first }
        return if (scan == 0x39) ' ' else null
    }

    companion object {
        const val TAG = "BeaconHost"
        const val MAX_MESSAGE = 2048
        const val MAX_PER_SECOND = 500

        /**
         * How long the finger stays down on the phone. The time between the viewer's press and release also includes
         * network delay, so a tap that arrived late would otherwise become a long, slow gesture that Android reads as a
         * long press or that cancels the next tap. A press shorter than half a second is a one-frame tap; a longer
         * one is a deliberate hold and keeps its length.
         */
        fun strokeDuration(moved: Boolean, heldMs: Long): Long =
            if (moved) heldMs.coerceIn(80, 2000) else if (heldMs < 500) 16 else heldMs.coerceIn(500, 2000)
        const val MAX_CLIPBOARD_CHARS = 32768
        const val MAX_CLIPBOARD_WRITE = 8000
        const val MAX_CLIPBOARD_HTML = 6000
        const val MAX_CLIPBOARD_IMAGE = 1_500_000
        const val MAX_CLIPBOARD_IMAGE_BASE64 = 2_100_000
        val LETTER_ROWS = listOf(0x10 to "qwertyuiop", 0x1e to "asdfghjkl", 0x2c to "zxcvbnm")
        val DIGITS = (2..11).toList()
        const val SHIFTED_DIGITS = "!@#$%^&*()"
        val PUNCTUATION =
            mapOf(
                0x0c to ('-' to '_'), 0x0d to ('=' to '+'), 0x1a to ('[' to '{'), 0x1b to (']' to '}'),
                0x27 to (';' to ':'), 0x28 to ('\'' to '"'), 0x29 to ('`' to '~'), 0x2b to ('\\' to '|'),
                0x33 to (',' to '<'), 0x34 to ('.' to '>'), 0x35 to ('/' to '?'),
            )
    }
}

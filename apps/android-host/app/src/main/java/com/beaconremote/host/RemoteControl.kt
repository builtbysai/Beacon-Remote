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
    private val onState: (Boolean) -> Unit,
) : DataChannel.Observer {
    // The screen's size in pixels; changes when the phone is turned (see [resize]).
    private var width = width
    private var height = height
    private var lastSequence = -1L
    private var windowStart = SystemClock.elapsedRealtime()
    private var count = 0
    private var lastMessage = SystemClock.elapsedRealtime()
    private var pointerX = width / 2
    private var pointerY = height / 2
    private var down = false
    private var downAt = 0L
    private val path = ArrayList<Pair<Int, Int>>()
    private var lastScroll = 0L
    private var shift = false
    private var capsLock = false
    private var modified = false
    private var open = false

    fun start() = channel.registerObserver(this)

    override fun onBufferedAmountChange(previous: Long) {}

    override fun onStateChange() {
        when (channel.state()) {
            DataChannel.State.OPEN -> {
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
        } catch (error: Exception) {
            Log.w(TAG, "Ignored input", error)
        }
    }

    /** Called about once a second by the session: held touches are let go when the viewer goes quiet. */
    fun quietCheck() {
        val quiet = SystemClock.elapsedRealtime() - lastMessage
        if (open && quiet >= 1500) release()
        if (open && quiet >= 30_000) stop()
    }

    fun release() {
        down = false
        path.clear()
        shift = false
        modified = false
    }

    fun stop() {
        if (!open) return
        open = false
        release()
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
                if (down && (path.isEmpty() || path.last() != (pointerX to pointerY))) path.add(pointerX to pointerY)
            }
            "button" -> {
                val isDown = input.getBoolean("down")
                when (input.getString("button")) {
                    "left" -> if (isDown) {
                        down = true
                        downAt = SystemClock.elapsedRealtime()
                        path.clear()
                        path.add(pointerX to pointerY)
                    } else if (down) {
                        down = false
                        finishStroke(service)
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
                // Android does not let a background service read the clipboard.
                val reply = JSONObject().put("type", "clipboard").put("text", "").put("truncated", false).put("unavailable", true)
                channel.send(DataChannel.Buffer(ByteBuffer.wrap(reply.toString().toByteArray()), false))
            }
            "release_all" -> release()
            "keep_alive" -> {}
        }
    }

    private fun finishStroke(service: ControlService) {
        val held = SystemClock.elapsedRealtime() - downAt
        val moved = path.size > 1
        // Up to 24 points of the path are enough to reproduce a swipe; a tap or long press is one point.
        val step = maxOf(1, path.size / 24)
        val points = if (moved) path.filterIndexed { index, _ -> index % step == 0 || index == path.lastIndex } else listOf(path[0])
        service.stroke(points, if (moved) held.coerceIn(80, 2000) else held.coerceIn(40, 2000))
        path.clear()
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

    private companion object {
        const val TAG = "BeaconHost"
        const val MAX_MESSAGE = 2048
        const val MAX_PER_SECOND = 500
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

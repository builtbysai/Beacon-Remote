package com.beaconremote.host

import android.os.SystemClock
import android.util.Log
import org.webrtc.VideoFrame

/**
 * Diagnostic only: how long, on the phone itself, from a viewer's touch going down until the screen picture first
 * changes noticeably. It excludes the network, the encoder's output and the browser, so it separates the phone's own
 * response (the app's animation and the capture) from the rest. Results go to logcat under BeaconPerformance.
 */
object PerfProbe {
    @Volatile private var downAt = 0L
    private var reference: ByteArray? = null
    private var referenceAt = 0L

    fun noteTouchDown() { downAt = SystemClock.elapsedRealtime() }

    /** Called on the capture thread with every new picture; converts to a coarse signature only when it must. */
    fun onFrame(frame: VideoFrame) {
        val now = SystemClock.elapsedRealtime()
        val waiting = downAt != 0L && now - downAt < 2000
        if (!waiting && now - referenceAt < 250) return
        val i420 = runCatching { frame.buffer.toI420() }.getOrNull() ?: return
        try {
            val sample = signature(i420)
            val before = reference
            if (waiting && before != null && changed(before, sample)) {
                Log.i("BeaconPerformance", "firstChangeMs=${now - downAt}")
                downAt = 0L
            }
            if (!waiting || before == null) { reference = sample; referenceAt = now }
        } finally { i420.release() }
    }

    private fun signature(buffer: VideoFrame.I420Buffer): ByteArray {
        val width = buffer.width; val height = buffer.height
        val columns = width / 32; val rows = height / 32
        val out = ByteArray(columns * rows)
        val y = buffer.dataY
        var index = 0
        for (row in 0 until rows) for (column in 0 until columns) {
            out[index++] = y.get(row * 32 * buffer.strideY + column * 32)
        }
        return out
    }

    private fun changed(a: ByteArray, b: ByteArray): Boolean {
        if (a.size != b.size) return false
        var different = 0
        for (i in a.indices) if (kotlin.math.abs((a[i].toInt() and 255) - (b[i].toInt() and 255)) > 24) different++
        return different * 100 > a.size * 3
    }
}

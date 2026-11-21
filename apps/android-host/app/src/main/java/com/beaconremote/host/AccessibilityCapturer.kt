package com.beaconremote.host

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Display
import androidx.annotation.RequiresApi
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import org.webrtc.CapturerObserver
import org.webrtc.JavaI420Buffer
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame

/** Opted-in, low-frame-rate administration. No MediaProjection token or lock-screen workaround. */
@RequiresApi(Build.VERSION_CODES.R)
class AccessibilityCapturer(
    private val context: Context,
    private val allowed: () -> Boolean,
    private val failed: (String) -> Unit,
) : VideoCapturer {
    private val handler = Handler(Looper.getMainLooper())
    private val conversion = Executors.newSingleThreadExecutor()
    private val delivery = Any()
    private var observer: CapturerObserver? = null
    @Volatile private var running = false
    @Volatile private var generation = 0

    override fun initialize(helper: SurfaceTextureHelper?, context: Context?, observer: CapturerObserver) { this.observer = observer }
    override fun isScreencast() = true
    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {}
    override fun startCapture(width: Int, height: Int, framerate: Int) {
        running = true
        handler.post {
            synchronized(delivery) {
                if (!running) return@post
                generation++
                observer?.onCapturerStarted(true)
            }
            capture(generation)
        }
    }
    override fun stopCapture() {
        // Wait for an in-flight observer call before the caller disposes the WebRTC source.
        synchronized(delivery) {
            if (running) { running = false; observer?.onCapturerStopped() }
        }
        handler.removeCallbacksAndMessages(null)
        handler.post { generation++ }
    }
    override fun dispose() { stopCapture(); conversion.shutdown() }

    private fun locallyAllowed(): Boolean =
        Identity(context).let { it.unattended && it.wantsAvailable } && UnattendedAccess.ready(context)

    private fun capture(epoch: Int) {
        if (!running || epoch != generation) return
        if (!locallyAllowed()) { failed("Unattended permission is off or the phone is locked"); return }
        // Paused, detached, or without a fresh lease: don't even ask Android for pixels.
        if (!allowed()) { handler.postDelayed({ capture(epoch) }, 500); return }
        val service = ControlService.instance ?: return
        var completed = false
        val timeout = Runnable {
            if (!completed && running && epoch == generation) { completed = true; failed("Screen access did not respond") }
        }
        handler.postDelayed(timeout, 2500)
        try {
            service.takeScreenshot(Display.DEFAULT_DISPLAY, context.mainExecutor, object : AccessibilityService.TakeScreenshotCallback {
                override fun onSuccess(result: AccessibilityService.ScreenshotResult) {
                    if (completed || !running || epoch != generation) { result.hardwareBuffer.close(); return }
                    completed = true
                    handler.removeCallbacks(timeout)
                    try {
                        conversion.execute {
                            result.hardwareBuffer.use { buffer ->
                                if (!running || epoch != generation) return@execute
                                if (locallyAllowed() && allowed()) {
                                    runCatching {
                                        val hardware = Bitmap.wrapHardwareBuffer(buffer, result.colorSpace) ?: error("No screen buffer")
                                        val bitmap = try { hardware.copy(Bitmap.Config.ARGB_8888, false) ?: error("No readable screen") } finally { hardware.recycle() }
                                        try { emit(bitmap) } finally { bitmap.recycle() }
                                    }.onFailure { failed("Screen access failed"); return@execute }
                                }
                            }
                            if (running && epoch == generation) handler.post { capture(epoch) }
                        }
                    } catch (_: RejectedExecutionException) {
                        result.hardwareBuffer.close()
                    }
                }
                override fun onFailure(errorCode: Int) {
                    if (completed) return
                    completed = true; handler.removeCallbacks(timeout)
                    if (!running || epoch != generation) return
                    if (errorCode == AccessibilityService.ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT) {
                        handler.postDelayed({ capture(epoch) }, 120)
                    } else { failed("This screen cannot be shared (protected content or permission unavailable)") }
                }
            })
        } catch (_: Exception) { completed = true; handler.removeCallbacks(timeout); failed("Screen access is unavailable") }
    }

    // Reused between pictures so a full-size frame does not allocate a new buffer each time.
    private var staging: java.nio.ByteBuffer? = null

    /**
     * Turns one screenshot into a video frame. libyuv does the colour conversion (the earlier per-pixel loop took longer
     * than the interval between pictures), and the picture keeps the phone's own resolution up to 1920 on its long side.
     */
    private fun emit(original: Bitmap) {
        val width = original.width / 2 * 2
        val height = original.height / 2 * 2
        if (width < 2 || height < 2) return
        val needed = original.rowBytes * original.height
        val bytes = staging?.takeIf { it.capacity() >= needed } ?: java.nio.ByteBuffer.allocateDirect(needed).also { staging = it }
        bytes.clear()
        original.copyPixelsToBuffer(bytes)
        val full = JavaI420Buffer.allocate(width, height)
        try {
            // The bitmap's memory order is R, G, B, A, which libyuv calls ABGR.
            org.webrtc.YuvHelper.ABGRToI420(
                bytes, original.rowBytes,
                full.dataY, full.strideY, full.dataU, full.strideU, full.dataV, full.strideV,
                width, height,
            )
            val scale = minOf(1.0, 1920.0 / maxOf(width, height))
            val out: org.webrtc.VideoFrame.I420Buffer
            if (scale < 1.0) {
                val sw = maxOf(2, (width * scale).toInt() / 2 * 2)
                val sh = maxOf(2, (height * scale).toInt() / 2 * 2)
                out = full.cropAndScale(0, 0, width, height, sw, sh).toI420() ?: full
            } else {
                out = full
            }
            try {
                synchronized(delivery) {
                    if (running && locallyAllowed() && allowed()) {
                        val frame = VideoFrame(out, 0, System.nanoTime())
                        observer?.onFrameCaptured(frame)
                    }
                }
            } finally {
                if (out !== full) out.release()
            }
        } finally { full.release() }
    }
}

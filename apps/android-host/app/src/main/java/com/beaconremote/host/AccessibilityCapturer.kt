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
                            if (running && epoch == generation) handler.postDelayed({ capture(epoch) }, 500)
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
                        handler.postDelayed({ capture(epoch) }, 1000)
                    } else { failed("This screen cannot be shared (protected content or permission unavailable)") }
                }
            })
        } catch (_: Exception) { completed = true; handler.removeCallbacks(timeout); failed("Screen access is unavailable") }
    }

    private fun emit(original: Bitmap) {
        val scale = minOf(1.0, 720.0 / maxOf(original.width, original.height))
        val width = maxOf(2, (original.width * scale).toInt() / 2 * 2)
        val height = maxOf(2, (original.height * scale).toInt() / 2 * 2)
        val bitmap = Bitmap.createScaledBitmap(original, width, height, true)
        val pixels = IntArray(width * height)
        try { bitmap.getPixels(pixels, 0, width, 0, 0, width, height) } finally { if (bitmap !== original) bitmap.recycle() }
        val buffer = JavaI420Buffer.allocate(width, height)
        try {
            for (y in 0 until height) for (x in 0 until width) {
                val rgb = pixels[y * width + x]
                val r = (rgb shr 16) and 255; val g = (rgb shr 8) and 255; val b = rgb and 255
                buffer.dataY.put(y * buffer.strideY + x, (((66*r + 129*g + 25*b + 128) shr 8) + 16).coerceIn(0,255).toByte())
                if (y % 2 == 0 && x % 2 == 0) {
                    buffer.dataU.put(y/2 * buffer.strideU + x/2, (((-38*r - 74*g + 112*b + 128) shr 8) + 128).coerceIn(0,255).toByte())
                    buffer.dataV.put(y/2 * buffer.strideV + x/2, (((112*r - 94*g - 18*b + 128) shr 8) + 128).coerceIn(0,255).toByte())
                }
            }
            synchronized(delivery) {
                if (running && locallyAllowed() && allowed()) {
                    val frame = VideoFrame(buffer, 0, System.nanoTime())
                    observer?.onFrameCaptured(frame)
                }
            }
        } finally { buffer.release(); pixels.fill(0) }
    }
}

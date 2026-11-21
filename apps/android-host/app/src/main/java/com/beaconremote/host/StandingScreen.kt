package com.beaconremote.host

import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.view.Display
import android.view.Surface
import org.webrtc.EglBase
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoFrame

/**
 * Fast screen sharing. Without it, a session that starts with no prompt can only take screenshots, which Android
 * limits to about three a second. With the owner's one-time confirmation of Android's own capture prompt, this keeps
 * one capture alive (Android shows its cast icon, and Beacon's notification says so) and any unattended session then
 * gets smooth video from it. Nothing leaves the phone from here: [sink] is set only while a session streams.
 */
object StandingScreen {
    @Volatile var active = false
        private set
    /** Receives each picture while a viewer is connected; null otherwise, so frames are dropped on the floor. */
    @Volatile var sink: ((VideoFrame) -> Unit)? = null
        set(value) {
            field = value
            // A viewer that connects to a screen that is not changing still needs a first picture.
            if (value != null) resendLast()
        }

    // The screen only produces a picture when something changes, so the newest one is kept (as I420, at most once a
    // second while nobody watches) and handed over again when a viewer connects or the picture has been still for a moment.
    private val lock = Any()
    private var last: org.webrtc.VideoFrame.I420Buffer? = null
    private var lastCachedAt = 0L
    private var lastDeliveredAt = 0L
    private var ticker: java.util.concurrent.ScheduledExecutorService? = null

    private var projection: MediaProjection? = null
    private var display: VirtualDisplay? = null
    private var helper: SurfaceTextureHelper? = null
    private var egl: EglBase? = null
    private var dpi = 320
    private var onStopped: (() -> Unit)? = null
    /** Set by a session that is streaming from here, so it can end cleanly if the capture is stopped under it. */
    @Volatile var lost: (() -> Unit)? = null

    /** Called from the foreground service, after it has gone foreground with the media projection type. */
    fun start(context: Context, resultCode: Int, data: Intent, stopped: () -> Unit): Boolean {
        stop(notify = false)
        val manager = context.getSystemService(MediaProjectionManager::class.java)
        val granted = runCatching { manager.getMediaProjection(resultCode, data) }.getOrNull() ?: return false
        projection = granted
        onStopped = stopped
        granted.registerCallback(object : MediaProjection.Callback() {
            override fun onStop() {
                // Android or the owner ended the capture (the cast icon's Stop, or the screen was locked on some phones).
                Handler(Looper.getMainLooper()).post { stop(notify = true) }
            }
        }, Handler(Looper.getMainLooper()))
        val metrics = DisplayMetrics()
        @Suppress("DEPRECATION")
        context.getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY).getRealMetrics(metrics)
        dpi = metrics.densityDpi
        val (width, height) = fit(metrics.widthPixels, metrics.heightPixels)
        val base = EglBase.create().also { egl = it }
        val surfaces = SurfaceTextureHelper.create("standing-screen", base.eglBaseContext).also { helper = it }
        surfaces.setTextureSize(width, height)
        display = granted.createVirtualDisplay(
            "beacon-screen", width, height, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            Surface(surfaces.surfaceTexture), null, null,
        )
        surfaces.startListening { frame -> onPicture(frame) }
        ticker = java.util.concurrent.Executors.newSingleThreadScheduledExecutor().also { scheduler ->
            scheduler.scheduleWithFixedDelay({
                if (sink != null && android.os.SystemClock.elapsedRealtime() - lastDeliveredAt >= 400) resendLast()
            }, 400, 200, java.util.concurrent.TimeUnit.MILLISECONDS)
        }
        active = true
        return true
    }

    private fun onPicture(frame: VideoFrame) {
        val now = android.os.SystemClock.elapsedRealtime()
        val receiver = sink
        if (receiver == null && now - lastCachedAt < 1000) return
        val i420 = frame.buffer.toI420() ?: return
        synchronized(lock) {
            last?.release()
            last = i420
            lastCachedAt = now
            if (receiver != null) deliver(receiver)
        }
    }

    private fun resendLast() {
        val receiver = sink ?: return
        synchronized(lock) { deliver(receiver) }
    }

    /** Must hold [lock]. Hands the newest picture to the session, which owns and releases its own reference. */
    private fun deliver(receiver: (VideoFrame) -> Unit) {
        val picture = last ?: return
        picture.retain()
        val frame = VideoFrame(picture, 0, System.nanoTime())
        lastDeliveredAt = android.os.SystemClock.elapsedRealtime()
        try { receiver(frame) } finally { frame.release() }
    }

    /** Matches the picture to the phone's current shape (it was turned) or to what a session asked for. */
    fun resize(width: Int, height: Int) {
        val surfaces = helper ?: return
        val (w, h) = fit(width, height)
        surfaces.setTextureSize(w, h)
        runCatching { display?.resize(w, h, dpi) }
    }

    fun stop(notify: Boolean = true) {
        val wasActive = active
        active = false
        sink = null
        ticker?.shutdownNow(); ticker = null
        synchronized(lock) { last?.release(); last = null }
        runCatching { helper?.stopListening() }
        runCatching { display?.release() }
        runCatching { helper?.dispose() }
        runCatching { egl?.release() }
        runCatching { projection?.stop() }
        display = null; helper = null; egl = null; projection = null
        val ended = lost
        lost = null
        if (wasActive) ended?.invoke()
        val callback = onStopped
        onStopped = null
        if (notify && wasActive) callback?.invoke()
    }

    /** At most 1920 on the long side, even numbers (encoders need them). */
    private fun fit(width: Int, height: Int): Pair<Int, Int> {
        val scale = minOf(1.0, 1920.0 / maxOf(width, height))
        return maxOf(2, (width * scale).toInt() / 2 * 2) to maxOf(2, (height * scale).toInt() / 2 * 2)
    }
}

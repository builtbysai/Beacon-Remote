package com.beaconremote.host

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import android.util.Log

/** Supported accessibility continuation, on its own thread so clipboard/UI work cannot queue touch input. */
internal class NativeTouchStream(
    private val service: ControlService,
    allowed: () -> Boolean,
    interrupted: () -> Unit,
    private val rejected: () -> Unit,
) {
    private val thread = HandlerThread("beacon-touch").apply { start() }
    private val handler = Handler(thread.looper)
    private var previous: GestureDescription.StrokeDescription? = null
    private var previousPoint: TouchStream.Point? = null
    private var startedAt = 0L
    private val stream = TouchStream(
        { ControlService.instance === service && allowed() },
        { action -> handler.post { action() } },
        ::dispatch,
        interrupted,
        { thread.quitSafely() },
    )
    private val holdLimit = Runnable { stream.cancel(); interrupted() }

    fun press(x: Int, y: Int): Boolean {
        val accepted = stream.press(TouchStream.Point(x, y))
        if (accepted) {
            handler.removeCallbacks(holdLimit)
            handler.postDelayed(holdLimit, 30_000)
        }
        return accepted
    }
    fun move(x: Int, y: Int) = stream.move(TouchStream.Point(x, y))
    fun lift(x: Int, y: Int) {
        handler.removeCallbacks(holdLimit)
        stream.lift(TouchStream.Point(x, y))
    }
    fun cancel() { handler.removeCallbacks(holdLimit); stream.cancel() }
    fun close() { handler.removeCallbacks(holdLimit); stream.close() }

    private fun path(from: TouchStream.Point, to: TouchStream.Point) = Path().apply {
        moveTo(from.x.toFloat(), from.y.toFloat())
        lineTo(to.x.toFloat(), to.y.toFloat())
    }

    private fun dispatch(segment: TouchStream.Segment, done: (Boolean) -> Unit): Boolean {
        if (segment.beginning) startedAt = SystemClock.elapsedRealtime()
        val prior = previous
        val stroke = runCatching {
            if (segment.beginning) GestureDescription.StrokeDescription(path(segment.from, segment.to), 0, segment.durationMs, segment.continues)
            else prior?.continueStroke(path(segment.from, segment.to), 0, segment.durationMs, segment.continues)
        }.getOrNull()
        if (stroke == null) {
            releaseOwned { done(false); rejected() }
            return true
        }
        var finished = false
        lateinit var watchdog: Runnable
        fun finish(success: Boolean) {
            if (finished) return
            finished = true
            handler.removeCallbacks(watchdog)
            previous = if (success && segment.continues) stroke else null
            previousPoint = if (success && segment.continues) segment.to else null
            if (success && !segment.continues && Log.isLoggable("BeaconPerformance", Log.DEBUG))
                Log.d("BeaconPerformance", "streamTouch completedMs=${SystemClock.elapsedRealtime() - startedAt}")
            done(success)
        }
        watchdog = Runnable {
            if (!finished) {
                finished = true
                releaseOwned { done(false); rejected() }
            }
        }
        val callback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) = finish(true)
            override fun onCancelled(gestureDescription: GestureDescription) = finish(false)
        }
        val accepted = runCatching {
            service.dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), callback, handler)
        }.getOrDefault(false)
        if (accepted) {
            // Keep the accepted continuation even before its callback, so an OS callback
            // lost during teardown cannot strand this contact or the owned handler thread.
            previous = if (segment.continues) stroke else null
            previousPoint = if (segment.continues) segment.to else null
            handler.postDelayed(watchdog, 250)
        } else {
            finished = true
            releaseOwned { done(false); rejected() }
        }
        return true
    }

    /** Only lift our existing contact at its accepted endpoint; never create a cleanup tap. */
    private fun releaseOwned(after: () -> Unit) {
        val stroke = previous
        val point = previousPoint
        if (stroke == null || point == null) { after(); return }
        var finished = false
        lateinit var watchdog: Runnable
        fun finish() {
            if (finished) return
            finished = true
            handler.removeCallbacks(watchdog)
            previous = null
            previousPoint = null
            after()
        }
        watchdog = Runnable { finish() }
        handler.postDelayed(watchdog, 250)
        val callback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) = finish()
            override fun onCancelled(gestureDescription: GestureDescription) = finish()
        }
        val accepted = runCatching {
            val lift = stroke.continueStroke(path(point, point), 0, 1, false)
            service.dispatchGesture(GestureDescription.Builder().addStroke(lift).build(), callback, handler)
        }.getOrDefault(false)
        if (!accepted) finish()
    }
}

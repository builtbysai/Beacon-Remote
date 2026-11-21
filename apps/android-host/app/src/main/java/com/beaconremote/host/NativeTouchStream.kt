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
        val stroke = if (segment.beginning) {
            GestureDescription.StrokeDescription(path(segment.from, segment.to), 0, segment.durationMs, segment.continues)
        } else {
            prior?.continueStroke(path(segment.from, segment.to), 0, segment.durationMs, segment.continues) ?: return false
        }
        val gesture = GestureDescription.Builder().addStroke(stroke).build()
        val callback = object : AccessibilityService.GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription) {
                previous = if (segment.continues) stroke else null
                previousPoint = if (segment.continues) segment.to else null
                if (!segment.continues && Log.isLoggable("BeaconPerformance", Log.DEBUG))
                    Log.d("BeaconPerformance", "streamTouch completedMs=${SystemClock.elapsedRealtime() - startedAt}")
                done(true)
            }
            override fun onCancelled(gestureDescription: GestureDescription) {
                previous = null
                previousPoint = null
                done(false)
            }
        }
        if (service.dispatchGesture(gesture, callback, handler)) return true
        // A rejected continuation must not strand the preceding held contact. Only lift at
        // its already committed point; never turn this cleanup into a fresh tap or movement.
        val point = previousPoint
        if (prior != null && point != null) {
            val release = prior.continueStroke(path(point, point), 0, 1, false)
            val cleanup = GestureDescription.Builder().addStroke(release).build()
            val cleanupCallback = object : AccessibilityService.GestureResultCallback() {
                private fun finish() { previous = null; previousPoint = null; done(false); rejected() }
                override fun onCompleted(gestureDescription: GestureDescription) = finish()
                override fun onCancelled(gestureDescription: GestureDescription) = finish()
            }
            if (service.dispatchGesture(cleanup, cleanupCallback, handler)) return true
        }
        previous = null
        previousPoint = null
        Log.w("BeaconHost", "Android refused touch dispatch")
        rejected()
        return false
    }
}

package com.beaconremote.host

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.ComponentName
import android.content.Context
import android.graphics.Path
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * Lets an approved helper touch and type on this phone. Android only allows that through an accessibility service
 * the person turns on themselves in Settings. This service does nothing on its own: it ignores every event and
 * acts only when [RemoteControl] calls it during a session the person allowed control for (ADR 0036).
 */
class ControlService : AccessibilityService() {
    override fun onServiceConnected() {
        instance = this
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}

    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        if (instance === this) instance = null
        return super.onUnbind(intent)
    }

    /** One finger down at the first point, moving through the rest, lifted after [durationMs]. */
    fun stroke(points: List<Pair<Int, Int>>, durationMs: Long): Boolean {
        if (points.isEmpty()) return false
        val path = Path().apply {
            moveTo(points[0].first.toFloat(), points[0].second.toFloat())
            // A tap is a stroke with no movement; Android needs a path with at least a point.
            if (points.size == 1) lineTo(points[0].first.toFloat(), points[0].second.toFloat())
            for (next in points.drop(1)) lineTo(next.first.toFloat(), next.second.toFloat())
        }
        val duration = durationMs.coerceIn(1, GestureDescription.getMaxGestureDuration())
        val gesture = GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, duration)).build()
        return dispatchGesture(gesture, null, null)
    }

    fun system(action: String): Boolean {
        val code =
            when (action) {
                "back" -> GLOBAL_ACTION_BACK
                "home" -> GLOBAL_ACTION_HOME
                "recents" -> GLOBAL_ACTION_RECENTS
                "notifications" -> GLOBAL_ACTION_NOTIFICATIONS
                else -> return false
            }
        return performGlobalAction(code)
    }

    /** Appends to the focused text field. */
    fun type(text: String): Boolean = edit { current -> current + text }

    /** Deletes the last character of the focused text field. */
    fun backspace(): Boolean = edit { current -> if (current.isEmpty()) current else current.substring(0, current.offsetByCodePoints(current.length, -1)) }

    /** The IME's Enter action (search, send, next) where the phone supports it, else a new line. */
    fun enter(): Boolean {
        val focused = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        return try {
            if (Build.VERSION.SDK_INT >= 30 && focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)) true else edit { it + "\n" }
        } finally {
            @Suppress("DEPRECATION") focused.recycle()
        }
    }

    // Apps re-process a field's text after each change, so the next read can lag behind what was just set.
    // The text last set is remembered briefly and used as the base while the field's own text is an older prefix of it.
    private var lastSet: String? = null
    private var lastSetAt = 0L

    private fun edit(change: (String) -> String): Boolean {
        val focused = rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return false
        return try {
            focused.refresh()
            // A field showing only its hint reports the hint as its text.
            val reported = if (focused.isShowingHintText) "" else focused.text?.toString().orEmpty()
            val remembered = lastSet
            val fresh = SystemClock.elapsedRealtime() - lastSetAt < 1500
            val current = if (remembered != null && fresh && remembered.startsWith(reported) && reported != remembered) remembered else reported
            val updated = change(current)
            val arguments = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, updated) }
            val done = focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)
            if (done) {
                lastSet = updated
                lastSetAt = SystemClock.elapsedRealtime()
                val end = Bundle().apply {
                    putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_START_INT, updated.length)
                    putInt(AccessibilityNodeInfo.ACTION_ARGUMENT_SELECTION_END_INT, updated.length)
                }
                focused.performAction(AccessibilityNodeInfo.ACTION_SET_SELECTION, end)
            }
            done
        } finally {
            @Suppress("DEPRECATION") focused.recycle()
        }
    }

    companion object {
        @Volatile var instance: ControlService? = null

        /** Whether the person has turned this service on in Settings. */
        fun enabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            val ours = ComponentName(context, ControlService::class.java).flattenToString()
            return enabled.split(':').any { it.equals(ours, ignoreCase = true) }
        }
    }
}

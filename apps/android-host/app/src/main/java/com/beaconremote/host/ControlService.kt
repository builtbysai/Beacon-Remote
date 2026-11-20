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
        android.util.Log.w("BeaconHost", "Accessibility service unbound (sharing=${HostState.sharing})")
        if (instance === this) instance = null
        // An app update or a restart unbinds the service too, but then Android still lists it as enabled and it
        // comes back by itself. Only a permission that is really gone turns unattended access off.
        if (enabled(this)) return super.onUnbind(intent)
        val identity = Identity(this)
        identity.unattended = false
        AccessIntents.notice = identity.accessBinding() to "Unattended access is off. Accessibility permission was removed."
        if (HostState.sharing) runCatching { startService(android.content.Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP)) }
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

    /**
     * The text on the phone's clipboard, or null when Android will not give it to this service. Android 10 and later
     * limit background clipboard reads, so a null here is an honest "unavailable", never an empty copy.
     */
    fun readClipboardText(): String? = runCatching {
        val clip = getSystemService(android.content.ClipboardManager::class.java).primaryClip ?: return null
        if (clip.itemCount == 0) return null
        clip.getItemAt(0).coerceToText(this)?.toString()
    }.getOrNull()

    /** Puts text on the phone's clipboard (a viewer asked, and the phone's clipboard mode allows it). */
    fun writeClipboardText(text: String): Boolean = runCatching {
        getSystemService(android.content.ClipboardManager::class.java)
            .setPrimaryClip(android.content.ClipData.newPlainText("Beacon Remote", text))
        true
    }.getOrDefault(false)

    /** Calls [onChange] whenever the phone's clipboard changes; returns how to stop listening. */
    fun listenForClipboard(onChange: () -> Unit): () -> Unit {
        val manager = getSystemService(android.content.ClipboardManager::class.java)
        val listener = android.content.ClipboardManager.OnPrimaryClipChangedListener { onChange() }
        manager.addPrimaryClipChangedListener(listener)
        return { manager.removePrimaryClipChangedListener(listener) }
    }

    /**
     * Presses one key on the phone's PIN screen for a viewer whose person is typing the passcode in the viewer. The
     * screen itself cannot be captured (Android marks it secure), so the viewer shows its own number pad and the key is
     * pressed here through the accessibility tree. Nothing about the key is stored or logged. Only digits, Delete and
     * Enter are accepted, only while the owner has turned on "Unlock from the viewer", and only while the phone is locked.
     */
    fun pressLockKey(key: String): String {
        if (!Identity(this).unlockFromViewer) return "off"
        if (!getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) return "not-locked"
        // The PIN screen is a SystemUI window; look through every window the service can see, not only the active one.
        // The tree is walked by hand: that is what Android reliably exposes for this screen.
        fun walk(node: AccessibilityNodeInfo?, depth: Int, test: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
            if (node == null || depth > 14) return null
            if (test(node)) return node
            for (index in 0 until node.childCount) walk(node.getChild(index), depth + 1, test)?.let { return it }
            return null
        }
        fun isPad(node: AccessibilityNodeInfo) = node.viewIdResourceName?.endsWith("pin_pad_grid") == true || node.text?.toString() == "Enter PIN"
        fun pad(): AccessibilityNodeInfo? =
            (listOfNotNull(rootInActiveWindow) + windows.mapNotNull { it.root })
                .firstOrNull { it.packageName?.toString() == "com.android.systemui" && walk(it, 0, ::isPad) != null }
        var root = pad()
        if (root == null) {
            // The PIN screen appears after swiping up on the lock screen.
            val metrics = resources.displayMetrics
            stroke(listOf(metrics.widthPixels / 2 to (metrics.heightPixels * 0.78).toInt(), metrics.widthPixels / 2 to (metrics.heightPixels * 0.25).toInt()), 300)
            for (attempt in 1..8) {
                Thread.sleep(400)
                root = pad()
                if (root != null) break
            }
        }
        val screen = root ?: run {
            // Counts only: nothing about what was typed.
            android.util.Log.i("BeaconHost", "PIN screen not found: windows=${windows.size} active=${rootInActiveWindow?.packageName}")
            // The labels of what the screen shows (key captions), to learn what Android exposes. Never what was pressed.
            fun dump(node: AccessibilityNodeInfo?, depth: Int, budget: IntArray) {
                if (node == null || budget[0] <= 0 || depth > 12) return
                budget[0]--
                android.util.Log.i("BeaconHost", "  node d=$depth ${node.className} text=${node.text?.toString()?.take(14)} desc=${node.contentDescription?.toString()?.take(14)} id=${node.viewIdResourceName?.takeLast(24)}")
                for (index in 0 until node.childCount) dump(node.getChild(index), depth + 1, budget)
            }
            dump(rootInActiveWindow, 0, intArrayOf(45))
            return "no-pad"
        }
        val target: AccessibilityNodeInfo? = walk(screen, 0) { node ->
            when (key) {
                "delete" -> node.contentDescription?.toString() == "Delete"
                "enter" -> node.contentDescription?.toString() == "Enter"
                else -> node.text?.toString() == key && node.className?.toString()?.endsWith("Button") == true
            }
        }
        var node = target
        while (node != null && !node.isClickable) node = node.parent
        return if (node != null && node.performAction(AccessibilityNodeInfo.ACTION_CLICK)) "ok" else "no-key"
    }

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
        private const val PIN_PAD = "com.android.systemui:id/pin_pad_grid"
        @Volatile var instance: ControlService? = null

        /** Whether the person has turned this service on in Settings. */
        fun enabled(context: Context): Boolean {
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            val ours = ComponentName(context, ControlService::class.java)
            return enabled.split(':').any { ComponentName.unflattenFromString(it) == ours }
        }
    }
}

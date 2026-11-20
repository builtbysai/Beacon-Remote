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
    fun writeClipboardText(text: String, html: String? = null): Boolean = runCatching {
        getSystemService(android.content.ClipboardManager::class.java).setPrimaryClip(
            if (html.isNullOrEmpty()) android.content.ClipData.newPlainText("Beacon Remote", text)
            else android.content.ClipData.newHtmlText("Beacon Remote", text, html),
        )
        true
    }.getOrDefault(false)

    /** Puts an image a viewer copied on the phone's clipboard, through a file in this app's own cache. */
    fun writeClipboardImage(bytes: ByteArray, mime: String): Boolean = runCatching {
        val folder = java.io.File(cacheDir, "clips").apply { mkdirs() }
        folder.listFiles()?.forEach { it.delete() }
        val file = java.io.File(folder, "clip-${System.currentTimeMillis()}.png")
        file.writeBytes(bytes)
        val uri = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.clips", file)
        getSystemService(android.content.ClipboardManager::class.java)
            .setPrimaryClip(android.content.ClipData.newUri(contentResolver, "Beacon Remote", uri))
        true
    }.getOrDefault(false)

    /** The image on the phone's clipboard (at most [max] bytes) and its type, or null. */
    fun readClipboardImage(max: Int): Pair<String, ByteArray>? = runCatching {
        val clip = getSystemService(android.content.ClipboardManager::class.java).primaryClip ?: return null
        if (clip.itemCount == 0) return null
        val uri = clip.getItemAt(0).uri ?: return null
        val mime = contentResolver.getType(uri) ?: clip.description.getMimeType(0)
        if (!mime.startsWith("image/")) return null
        val bytes = contentResolver.openInputStream(uri)?.use { input ->
            val out = java.io.ByteArrayOutputStream()
            val chunk = ByteArray(8192)
            while (true) {
                val count = input.read(chunk)
                if (count < 0) break
                if (out.size() + count > max) return null
                out.write(chunk, 0, count)
            }
            out.toByteArray()
        } ?: return null
        if (bytes.isEmpty()) null else mime to bytes
    }.getOrNull()

    /**
     * Reads the clipboard through a brief invisible Beacon screen, for when Android refuses a background read. Only on an
     * unlocked phone; returns null if Android does not let the screen open or nothing could be read.
     */
    internal fun readClipboardViaActivity(timeoutMs: Long = 2500): ClipSnapshot? {
        if (getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) return null
        val future = java.util.concurrent.CompletableFuture<ClipSnapshot?>()
        ClipHandoff.pending = future
        return try {
            startActivity(
                android.content.Intent(this, ClipReadActivity::class.java)
                    .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK or android.content.Intent.FLAG_ACTIVITY_NO_ANIMATION or android.content.Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS),
            )
            future.get(timeoutMs, java.util.concurrent.TimeUnit.MILLISECONDS)
        } catch (error: Exception) {
            ClipHandoff.pending = null
            null
        }
    }

    /** Removes images left in the clipboard cache. */
    fun clearClipboardImages() {
        runCatching { java.io.File(cacheDir, "clips").listFiles()?.forEach { it.delete() } }
    }

    /** The formatted version of the phone's clipboard text, when the copy carries one. */
    fun readClipboardHtml(): String? = runCatching {
        val clip = getSystemService(android.content.ClipboardManager::class.java).primaryClip ?: return null
        if (clip.itemCount == 0) null else clip.getItemAt(0).htmlText
    }.getOrNull()

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
    // The PIN screen is a SystemUI window; look through every window the service can see, not only the active one.
    // The tree is walked by hand: that is what Android reliably exposes for this screen.
    private fun walkTree(node: AccessibilityNodeInfo?, depth: Int, test: (AccessibilityNodeInfo) -> Boolean): AccessibilityNodeInfo? {
        if (node == null || depth > 14) return null
        if (test(node)) return node
        for (index in 0 until node.childCount) walkTree(node.getChild(index), depth + 1, test)?.let { return it }
        return null
    }

    private fun isPinPad(node: AccessibilityNodeInfo) = node.viewIdResourceName?.endsWith("pin_pad_grid") == true || node.text?.toString() == "Enter PIN"

    private fun isPatternView(node: AccessibilityNodeInfo) = node.viewIdResourceName?.endsWith("lockPatternView") == true

    private fun isPasswordField(node: AccessibilityNodeInfo) = node.viewIdResourceName?.endsWith("passwordEntry") == true

    /** The credential screen that is up (PIN pad, pattern grid or password field) and which kind it is. */
    private fun findLockRoot(): Pair<AccessibilityNodeInfo, String>? {
        for (root in listOfNotNull(rootInActiveWindow) + windows.mapNotNull { it.root }) {
            if (root.packageName?.toString() != "com.android.systemui") continue
            if (walkTree(root, 0, ::isPinPad) != null) return root to "pin"
            if (walkTree(root, 0, ::isPatternView) != null) return root to "pattern"
            if (walkTree(root, 0, ::isPasswordField) != null) return root to "password"
        }
        return null
    }

    private fun lockRootOrReveal(): AccessibilityNodeInfo? {
        var found = findLockRoot()?.first
        if (found == null) {
            swipeUpToPin()
            for (attempt in 1..8) {
                Thread.sleep(400)
                found = findLockRoot()?.first
                if (found != null) break
            }
        }
        return found
    }

    /**
     * Draws a pattern for a viewer whose person knows it: a finger path through the centres of the grid's cells (0 is the
     * top left, 8 the bottom right). Nothing about the pattern is stored or logged.
     */
    fun drawLockPattern(cells: List<Int>): String {
        if (!Identity(this).unlockFromViewer) return "off"
        if (!getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) return "not-locked"
        if (cells.size !in 2..9 || cells.toSet().size != cells.size || cells.any { it !in 0..8 }) return "bad"
        val screen = lockRootOrReveal() ?: return "no-pad"
        val grid = walkTree(screen, 0, ::isPatternView) ?: return "no-key"
        val bounds = android.graphics.Rect()
        grid.getBoundsInScreen(bounds)
        val points = cells.map { cell ->
            (bounds.left + bounds.width() * (cell % 3 * 2 + 1) / 6) to (bounds.top + bounds.height() * (cell / 3 * 2 + 1) / 6)
        }
        return if (stroke(points, 220L * points.size)) "ok" else "no-key"
    }

    /** Types a password into the lock screen's field and presses its Enter action. Never stored or logged. */
    fun enterLockPassword(text: String): String {
        if (!Identity(this).unlockFromViewer) return "off"
        if (!getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) return "not-locked"
        if (text.isEmpty() || text.length > 64) return "bad"
        val screen = lockRootOrReveal() ?: return "no-pad"
        val field = walkTree(screen, 0, ::isPasswordField) ?: return "no-key"
        field.performAction(AccessibilityNodeInfo.ACTION_FOCUS)
        val args = Bundle().apply { putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text) }
        if (!field.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)) return "no-key"
        val enter = Build.VERSION.SDK_INT >= 30 && field.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
        return if (enter) "ok" else "typed"
    }

    private fun findPinRoot(): AccessibilityNodeInfo? =
        (listOfNotNull(rootInActiveWindow) + windows.mapNotNull { it.root })
            .firstOrNull { it.packageName?.toString() == "com.android.systemui" && walkTree(it, 0, ::isPinPad) != null }

    /** One swipe up from the lock screen, which brings up the PIN screen. */
    fun swipeUpToPin() {
        val metrics = resources.displayMetrics
        stroke(listOf(metrics.widthPixels / 2 to (metrics.heightPixels * 0.78).toInt(), metrics.widthPixels / 2 to (metrics.heightPixels * 0.25).toInt()), 300)
    }

    /**
     * What the PIN screen shows, as captions and where they sit, so the viewer can draw a stand-in for the picture
     * Android hides. Only the credential screen's own parts are listed (not notifications), and nothing about what
     * was pressed.
     */
    fun lockScreenSnapshot(): org.json.JSONObject {
        val metrics = resources.displayMetrics
        val out = org.json.JSONObject().put("type", "lockscreen").put("w", metrics.widthPixels).put("h", metrics.heightPixels)
        if (!Identity(this).unlockFromViewer) return out.put("state", "off")
        if (!getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) return out.put("state", "not-locked")
        val (root, lock) = findLockRoot() ?: return out.put("state", "no-pad")
        out.put("lock", lock)
        if (lock == "pattern") {
            // The grid itself: where it is on the screen, for the viewer's stand-in.
            val grid = walkTree(root, 0, ::isPatternView)
            val bounds = android.graphics.Rect()
            grid?.getBoundsInScreen(bounds)
            return out.put("state", "pad").put("nodes", org.json.JSONArray())
                .put("grid", org.json.JSONObject().put("x", bounds.left).put("y", bounds.top).put("w", bounds.width()).put("h", bounds.height()))
        }
        if (lock == "password") return out.put("state", "pad").put("nodes", org.json.JSONArray())
        val nodes = org.json.JSONArray()
        fun collect(node: AccessibilityNodeInfo?, depth: Int) {
            if (node == null || depth > 14 || nodes.length() >= 40) return
            if (node.viewIdResourceName?.endsWith("notification_container") == true) return
            val label = (node.text?.toString()?.takeIf { it.isNotBlank() } ?: node.contentDescription?.toString()).orEmpty().take(24)
            val isKey = node.className?.toString()?.endsWith("Button") == true
            if (label.isNotEmpty() || isKey) {
                val bounds = android.graphics.Rect()
                node.getBoundsInScreen(bounds)
                if (bounds.width() > 0 && bounds.height() > 0) {
                    nodes.put(org.json.JSONObject().put("x", bounds.left).put("y", bounds.top).put("w", bounds.width()).put("h", bounds.height())
                        .put("text", label).put("kind", if (isKey) "key" else "text"))
                }
            }
            for (index in 0 until node.childCount) collect(node.getChild(index), depth + 1)
        }
        // Only the credential area itself: the clock, status line and shortcuts around it are not part of the PIN screen.
        collect(walkTree(root, 0) { it.viewIdResourceName?.endsWith("BouncerContent") == true } ?: root, 0)
        return out.put("state", "pad").put("nodes", nodes)
    }

    fun pressLockKey(key: String): String {
        if (!Identity(this).unlockFromViewer) return "off"
        if (!getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) return "not-locked"
        var root = findPinRoot()
        if (root == null) {
            // The PIN screen appears after swiping up on the lock screen.
            swipeUpToPin()
            for (attempt in 1..8) {
                Thread.sleep(400)
                root = findPinRoot()
                if (root != null) break
            }
        }
        val screen = root ?: run {
            // Counts only: nothing about what was typed.
            android.util.Log.i("BeaconHost", "PIN screen not found: windows=${windows.size} active=${rootInActiveWindow?.packageName}")
            return "no-pad"
        }
        val target: AccessibilityNodeInfo? = walkTree(screen, 0) { node ->
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

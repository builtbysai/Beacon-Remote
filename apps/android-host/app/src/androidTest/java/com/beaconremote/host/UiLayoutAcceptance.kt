package com.beaconremote.host

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.app.UiAutomation
import android.app.UiModeManager
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Rect
import android.os.Bundle
import android.os.SystemClock
import android.provider.Settings
import android.view.View
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread
import okhttp3.Request
import org.json.JSONObject

/** UI/async regressions on a new unpaired emulator, with a loopback dummy API. */
class UiLayoutAcceptance : Instrumentation() {
    private var arguments = Bundle()
    override fun onCreate(arguments: Bundle?) { this.arguments = arguments ?: Bundle(); super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        val identity = Identity(targetContext)
        val current = AtomicReference<Activity?>()
        val callbacks = object : Application.ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) { current.set(activity) }
            override fun onActivityCreated(activity: Activity, state: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) { current.compareAndSet(activity, null) }
        }
        var ui: UiAutomation? = null
        var registered = false
        var ownsIdentity = false
        var changedSettings = false
        var originalFont: String? = null
        var originalNight = UiModeManager.MODE_NIGHT_NO
        var code = Activity.RESULT_CANCELED
        try {
            check(android.os.Build.HARDWARE in listOf("ranchu", "goldfish")) { "UI runner requires a disposable emulator" }
            check(!identity.paired) { "UI runner refuses a paired device" }
            val server = arguments.getString("server").orEmpty()
            check(Regex("http://10\\.0\\.2\\.2:[0-9]{1,5}").matches(server)) { "A loopback fixture API is required" }
            val automation = getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).also { ui = it }
            val enabled = Settings.Secure.getString(targetContext.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            check(enabled.isBlank()) { "A fresh emulator without accessibility services is required" }
            check(androidx.core.app.NotificationManagerCompat.from(targetContext).areNotificationsEnabled()) { "Grant notifications on the named emulator before this test" }
            originalFont = Settings.System.getString(targetContext.contentResolver, Settings.System.FONT_SCALE)
            originalNight = targetContext.getSystemService(UiModeManager::class.java).nightMode
            (targetContext.applicationContext as Application).registerActivityLifecycleCallbacks(callbacks)
            registered = true
            ownsIdentity = true
            startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            waitFor("pairing form") { current.get() is MainActivity }
            screenshot(automation, "pairing-light")
            appearance(automation, current, "yes", "1.0")
            screenshot(automation, "pairing-dark")
            appearance(automation, current, "no", "1.0")
            // Review R09: a pairing link fills the form, names its unusual server in plain words, and pairs nothing until Pair.
            val link = android.net.Uri.parse("beaconremote://pair").buildUpon()
                .appendQueryParameter("code", "aB3_dE6-gH9_jK2-mN5_pQ8-rS1_tU4v").appendQueryParameter("server", server).build()
            onMain { targetContext.startActivity(Intent(Intent.ACTION_VIEW, link).setPackage(targetContext.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)) }
            waitFor("link filled the form") { (current.get() as? MainActivity)?.findViewById<EditText>(R.id.pair_code)?.text?.toString() == "aB3_dE6-gH9_jK2-mN5_pQ8-rS1_tU4v" }
            onMain {
                val active = current.get() as MainActivity
                check(active.findViewById<EditText>(R.id.pair_server).text.toString() == server) { "The link's server was not put in the form" }
                val note = tagged(active, "pair-server-note") as android.widget.TextView
                check(note.visibility == View.VISIBLE && note.text.contains(android.net.Uri.parse(server).host!!)) { "An unusual server was not shown before Pair" }
            }
            SystemClock.sleep(1500)
            check(!identity.paired && fixture(server).optInt("enrollments") == 0) { "A pairing link paired without a tap" }
            screenshot(automation, "pairing-link-light")
            val screen = current.get() as MainActivity
            onMain {
                screen.findViewById<EditText>(R.id.pair_server).setText(server)
                screen.findViewById<EditText>(R.id.pair_name).setText("Synthetic Android device with a long name")
                val code = screen.findViewById<EditText>(R.id.pair_code)
                check(code.inputType and android.text.InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS == 0) { "Keyboard must preserve code case" }
                code.setText("aB3_dE6-gH9_jK2-mN5_pQ8-rS1_tU4v")
                screen.window.decorView.findViewWithTag<Button>("pair-submit").performClick()
                check(!screen.findViewById<EditText>(R.id.pair_name).isEnabled)
            }
            waitFor("enrollment request reached the dummy server") { fixture(server).optInt("enrollments") == 1 }
            val blocked = CountDownLatch(1)
            val released = CountDownLatch(1)
            val releaseFailure = AtomicReference<Throwable?>()
            thread(name = "fixture-enrollment-release") {
                try {
                    check(blocked.await(5, TimeUnit.SECONDS))
                    Api.http.newCall(Request.Builder().url("$server/fixture/release-enrollment").build()).execute().use { check(it.isSuccessful) }
                } catch (error: Throwable) { releaseFailure.set(error) }
                finally { released.countDown() }
            }
            onMain {
                blocked.countDown()
                // The dummy response arrives while the UI queue is blocked. A
                // polling callback must not delete the completion callback.
                val deadline = SystemClock.uptimeMillis() + 4000
                while (!identity.paired && SystemClock.uptimeMillis() < deadline) Thread.sleep(25)
                check(identity.paired) { "The dummy response did not arrive during the queued-completion test" }
                Thread.sleep(100)
            }
            check(released.await(5, TimeUnit.SECONDS))
            releaseFailure.get()?.let { throw it }
            waitFor("pairing completion") { identity.paired && tagged(current.get(), "availability-toggle") != null }
            ownsIdentity = true
            onMain { targetContext.startService(Intent(targetContext, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP)) }
            waitFor("offline state") { !identity.wantsAvailable }
            Api.http.newCall(Request.Builder().url("$server/fixture/stale-heartbeat").build()).execute().use { check(it.isSuccessful) }
            onMain { AvailabilityService.start(targetContext) }
            waitFor("delayed old heartbeat") { fixture(server).optInt("staleHeartbeats") == 1 }
            val oldCount = fixture(server).optInt("heartbeats")
            onMain { targetContext.startService(Intent(targetContext, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP)) }
            waitFor("availability stopped") { !identity.wantsAvailable }
            onMain { AvailabilityService.start(targetContext) }
            waitFor("new availability run") { fixture(server).optInt("heartbeats") > oldCount && identity.wantsAvailable }
            SystemClock.sleep(2800)
            check(identity.wantsAvailable && identity.paired && HostState.status == "Available") { "An obsolete heartbeat changed the restarted host" }
            onMain { targetContext.startService(Intent(targetContext, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP)) }
            waitFor("stopped status") { !identity.wantsAvailable && HostState.status == "Not available" }
            changedSettings = true
            shell(automation, "settings put secure enabled_accessibility_services com.beaconremote.host/.ControlService")
            shell(automation, "settings put secure accessibility_enabled 1")
            waitFor("accessibility binding") { UnattendedAccess.ready(targetContext) }
            // The switch lives on the Access tab since the Nov 20 tab redesign.
            openTab(current, "access", "access-toggle")
            onMain { (tagged(current.get(), "access-toggle") as Button).performClick() }
            waitFor("enable request reached the dummy server") { fixture(server).optInt("enables") > 0 }
            onMain { (tagged(current.get(), "access-toggle") as Button).performClick() }
            waitFor("late enable was cancelled") { !AccessIntents.fence.pending(identity.accessBinding()) && fixture(server).optInt("disables") > 0 }
            check(!identity.unattended) { "A late enable response restored access" }
            onMain { ControlService.instance?.disableSelf() }
            waitFor("accessibility disabled") { ControlService.instance == null }
            // Guided setup may have opened Android's accessibility page over the app; bring the app back in front.
            onMain { targetContext.startActivity(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)) }
            openTab(current, "device", "session-card")
            screenshot(automation, "paired-light")
            // The paired tabs in both themes, then Privacy at the system's largest font (review R33: no clipped choice).
            for (night in listOf("no", "yes")) {
                appearance(automation, current, night, "1.0")
                val theme = if (night == "yes") "dark" else "light"
                for ((page, marker) in listOf("device" to "session-card", "access" to "access-toggle", "privacy" to "clipboard-mode")) {
                    openTab(current, page, marker)
                    screenshot(automation, "$page-$theme")
                }
                // The "..." menu sheet, then its Connection details sheet.
                onMain { tagged(current.get(), "more-options")!!.performClick() }
                SystemClock.sleep(600)
                screenshot(automation, "menu-$theme")
                shell(automation, "input keyevent KEYCODE_BACK")
                SystemClock.sleep(400)
            }
            appearance(automation, current, "no", "2.0")
            openTab(current, "privacy", "clipboard-mode")
            onMain {
                val active = current.get()!!
                val minimum = (48 * active.resources.displayMetrics.density).toInt()
                for (mode in listOf("auto", "button", "off")) {
                    val segment = tagged(active, "clipboard-$mode") as android.widget.TextView
                    val layout = checkNotNull(segment.layout)
                    val needed = layout.getLineBottom(layout.lineCount - 1) + segment.totalPaddingTop + segment.totalPaddingBottom
                    check(segment.height >= needed) { "Clipboard choice clipped at 200% font: $mode (${segment.height} < $needed)" }
                    check(segment.height >= minimum) { "Clipboard choice under 48 dp: $mode" }
                    for (line in 0 until layout.lineCount - 1) check(segment.text[layout.getLineEnd(line) - 1].isWhitespace()) { "Clipboard choice broken mid-word at 200% font: $mode" }
                    val info = android.view.accessibility.AccessibilityNodeInfo.obtain()
                    segment.onInitializeAccessibilityNodeInfo(info)
                    check(info.isCheckable && info.isChecked == (Identity(active).clipboardMode == mode)) { "Clipboard choice does not report its selection: $mode" }
                }
                // The tabs say which one is selected, and every tab is a 48 dp+ target.
                for (page in listOf("device", "access", "privacy")) {
                    val item = tagged(active, "nav-$page")!!
                    val info = android.view.accessibility.AccessibilityNodeInfo.obtain()
                    item.onInitializeAccessibilityNodeInfo(info)
                    check(info.isSelected == (page == "privacy")) { "Tab does not report its selection: $page" }
                    check(item.height >= minimum) { "Tab under 48 dp: $page" }
                }
            }
            screenshot(automation, "privacy-large-light")
            appearance(automation, current, "no", "1.0")
            openTab(current, "device", "session-card")
            val grant = JSONObject().put("id", UUID.randomUUID().toString()).put("token", "synthetic-not-a-real-grant")
                .put("controller", "Long synthetic helper identity — fixture@example.test")
                .put("capability", "desktop:control")
            val consent = ConsentActivity.requestIntent(targetContext, grant, identity.accessBinding())
            startActivitySync(consent)
            waitFor("approval") { current.get() is ConsentActivity }
            val before = Bundle()
            onMain {
                callActivityOnSaveInstanceState(current.get()!!, before)
                check(!checkboxes(current.get()!!.window.decorView).any { it.isChecked })
            }
            for ((name, rotation, scale, night) in listOf(
                Mode("consent-portrait-light", UiAutomation.ROTATION_FREEZE_0, "1.0", "no"),
                Mode("consent-landscape-light", UiAutomation.ROTATION_FREEZE_90, "1.0", "no"),
                Mode("consent-landscape-large", UiAutomation.ROTATION_FREEZE_90, "2.0", "no"),
                Mode("consent-landscape-dark-large", UiAutomation.ROTATION_FREEZE_90, "2.0", "yes"),
                Mode("consent-portrait-dark", UiAutomation.ROTATION_FREEZE_0, "1.0", "yes"),
            )) {
                automation.setRotation(rotation)
                shell(automation, "settings put system font_scale $scale")
                shell(automation, "cmd uimode night $night")
                SystemClock.sleep(1200)
                waitFor("approval after configuration change") {
                    val active = current.get()
                    val config = active?.resources?.configuration
                    active is ConsentActivity && tagged(active, "consent-allow") != null &&
                        config?.fontScale == scale.toFloat() &&
                        config.orientation == (if (rotation == UiAutomation.ROTATION_FREEZE_0) android.content.res.Configuration.ORIENTATION_PORTRAIT else android.content.res.Configuration.ORIENTATION_LANDSCAPE) &&
                        (config.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES) == (night == "yes")
                }
                val after = Bundle()
                onMain {
                    val active = current.get()!!
                    callActivityOnSaveInstanceState(active, after)
                    check(before.getLong("deadline") == after.getLong("deadline")) { "Rotation reset the approval deadline" }
                    check(!checkboxes(active.window.decorView).any { it.isChecked }) { "Configuration change raised consent" }
                    for (tag in listOf("consent-allow", "consent-decline")) {
                        val button = tagged(active, tag)!!
                        val visible = Rect()
                        check(button.getGlobalVisibleRect(visible) && visible.width() >= button.width && visible.height() >= button.height) { "Critical approval control clipped: $name/$tag" }
                    }
                }
                screenshot(automation, name)
            }
            val original = current.get()!!
            onMain { targetContext.startActivity(consent) }
            waitForIdleSync()
            onMain {
                check(current.get() === original) { "Duplicate delivery restarted consent" }
                val duplicate = Bundle()
                callActivityOnSaveInstanceState(original, duplicate)
                check(duplicate.getLong("deadline") == before.getLong("deadline")) { "Duplicate delivery extended approval" }
            }
            val nextId = UUID.randomUUID().toString()
            val replacement = JSONObject(grant.toString()).put("id", nextId)
            onMain { targetContext.startActivity(ConsentActivity.requestIntent(targetContext, replacement, identity.accessBinding())) }
            waitFor("replacement approval") {
                val active = current.get()
                active is ConsentActivity && active !== original &&
                    JSONObject(active.intent.getStringExtra("grant")!!).getString("id") == nextId
            }
            waitFor("superseded approval was declined") { fixture(server).optInt("declines") == 1 }
            onMain { (tagged(current.get(), "consent-decline") as Button).performClick() }
            waitFor("decline returns to setup") { current.get() is MainActivity }
            waitFor("decline reached the dummy server") { fixture(server).optInt("declines") == 2 }
            val expired = JSONObject(grant.toString()).put("id", UUID.randomUUID().toString())
                .put("approvalExpiresAtMillis", System.currentTimeMillis() - 1)
            onMain { targetContext.startActivity(ConsentActivity.requestIntent(targetContext, expired, identity.accessBinding())) }
            waitFor("expired delivery was declined") { fixture(server).optInt("declines") == 3 }
            check(!HostState.sharing)
            result.putString("stream", "PASS: real native setup/approval, async completion, late-enable cancellation, light/dark, portrait/landscape, enlarged text, duplicate delivery, replacement and expired approval; dummy API only\n")
            code = Activity.RESULT_OK
        } catch (error: Throwable) {
            result.putString("stream", "FAIL: ${error.javaClass.simpleName}: ${error.message}\n${error.stackTraceToString()}\n")
        } finally {
            if (registered) onMain {
                current.get()?.finish()
                targetContext.startService(Intent(targetContext, CaptureService::class.java).setAction(CaptureService.ACTION_STOP))
                targetContext.startService(Intent(targetContext, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP))
                if (ownsIdentity) { identity.clear(); AccessIntents.notice = null }
            }
            if (registered) ui?.let { automation ->
                if (changedSettings) {
                    shell(automation, "settings delete secure enabled_accessibility_services")
                    shell(automation, "settings put secure accessibility_enabled 0")
                }
                if (originalFont != null) shell(automation, "settings put system font_scale ${originalFont!!.toFloat()}")
                else shell(automation, "settings delete system font_scale")
                shell(automation, "cmd uimode night ${if (originalNight == UiModeManager.MODE_NIGHT_YES) "yes" else if (originalNight == UiModeManager.MODE_NIGHT_NO) "no" else "auto"}")
                automation.setRotation(UiAutomation.ROTATION_UNFREEZE)
            }
            if (registered) (targetContext.applicationContext as Application).unregisterActivityLifecycleCallbacks(callbacks)
        }
        finish(code, result)
    }
    // Instrumentation's SyncRunnable does not transfer exceptions back to its
    // caller. Capture assertions here so failures reach the runner's finally
    // and clean its disposable identity instead of crashing the app process.
    private fun onMain(action: () -> Unit) {
        val failure = AtomicReference<Throwable?>()
        runOnMainSync { try { action() } catch (error: Throwable) { failure.set(error) } }
        failure.get()?.let { throw it }
    }
    private data class Mode(val name: String, val rotation: Int, val scale: String, val night: String)
    /** Sets dark mode and font scale, then waits until the app's screen has been recreated with both. */
    private fun appearance(ui: UiAutomation, current: AtomicReference<Activity?>, night: String, scale: String) {
        shell(ui, "settings put system font_scale $scale")
        shell(ui, "cmd uimode night $night")
        SystemClock.sleep(1000)
        waitFor("appearance night=$night font=$scale") {
            val config = (current.get() as? MainActivity)?.resources?.configuration
            config != null && config.fontScale == scale.toFloat() &&
                (config.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK == android.content.res.Configuration.UI_MODE_NIGHT_YES) == (night == "yes")
        }
        waitForIdleSync()
    }
    private fun openTab(current: AtomicReference<Activity?>, page: String, marker: String) {
        onMain { tagged(current.get(), "nav-$page")!!.performClick() }
        waitFor("$page tab") { tagged(current.get(), marker) != null }
        waitForIdleSync()
    }
    private fun tagged(activity: Activity?, tag: String): View? = activity?.window?.decorView?.findViewWithTag(tag)
    private fun checkboxes(view: View): List<CheckBox> = if (view is CheckBox) listOf(view) else if (view is android.view.ViewGroup) (0 until view.childCount).flatMap { checkboxes(view.getChildAt(it)) } else emptyList()
    private fun waitFor(what: String, condition: () -> Boolean) {
        android.util.Log.i("UiLayoutAcceptance", "wait: $what")
        repeat(100) { if (condition()) return; SystemClock.sleep(100) }
        error("Timed out: $what")
    }
    private fun shell(ui: UiAutomation, command: String) { android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand(command)).use { it.readBytes() } }
    private fun fixture(server: String): JSONObject = Api.http.newCall(Request.Builder().url("$server/fixture/state").build()).execute().use { JSONObject(it.body!!.string()) }
    private fun screenshot(ui: UiAutomation, name: String) {
        android.util.Log.i("UiLayoutAcceptance", "screenshot: $name")
        waitForIdleSync()
        SystemClock.sleep(900) // let rotation and the system bars settle, so the capture matches the theme
        waitFor("unobscured app window: $name") { ui.rootInActiveWindow?.packageName?.toString() == "com.beaconremote.host" }
        val image = checkNotNull(ui.takeScreenshot())
        val file = File(checkNotNull(targetContext.getExternalFilesDir("ui")), "$name.png")
        file.parentFile!!.mkdirs()
        FileOutputStream(file).use { check(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        image.recycle()
    }
}

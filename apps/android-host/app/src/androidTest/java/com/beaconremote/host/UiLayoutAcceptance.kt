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
            val screen = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            waitFor("pairing form") { current.get() is MainActivity }
            screenshot(automation, "pairing-light")
            onMain {
                screen.findViewById<EditText>(R.id.pair_server).setText(server)
                screen.findViewById<EditText>(R.id.pair_name).setText("Synthetic Android device with a long name")
                screen.findViewById<EditText>(R.id.pair_code).setText("DUMMY-CODE")
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
            onMain { (tagged(current.get(), "access-toggle") as Button).performClick() }
            waitFor("enable request reached the dummy server") { fixture(server).optInt("enables") > 0 }
            onMain { (tagged(current.get(), "access-toggle") as Button).performClick() }
            waitFor("late enable was cancelled") { !AccessIntents.fence.pending(identity.accessBinding()) && fixture(server).optInt("disables") > 0 }
            check(!identity.unattended) { "A late enable response restored access" }
            onMain { ControlService.instance?.disableSelf() }
            waitFor("accessibility disabled") { ControlService.instance == null }
            screenshot(automation, "paired-light")
            val grant = JSONObject().put("id", UUID.randomUUID().toString()).put("token", "synthetic-not-a-real-grant")
                .put("controller", "Long synthetic helper identity — fixture@example.test")
                .put("capability", "desktop:control")
            startActivitySync(Intent(targetContext, ConsentActivity::class.java).putExtra("grant", grant.toString()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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
            onMain { (tagged(current.get(), "consent-decline") as Button).performClick() }
            waitFor("decline returns to setup") { current.get() is MainActivity }
            waitFor("decline reached the dummy server") { fixture(server).optInt("declines") == 1 }
            check(!HostState.sharing)
            result.putString("stream", "PASS: real native setup/approval, async completion, late-enable cancellation, light/dark, portrait/landscape, enlarged text, visible approval controls and unchanged deadline; dummy API only\n")
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
    private fun tagged(activity: Activity?, tag: String): View? = activity?.window?.decorView?.findViewWithTag(tag)
    private fun checkboxes(view: View): List<CheckBox> = if (view is CheckBox) listOf(view) else if (view is android.view.ViewGroup) (0 until view.childCount).flatMap { checkboxes(view.getChildAt(it)) } else emptyList()
    private fun waitFor(what: String, condition: () -> Boolean) {
        repeat(100) { if (condition()) return; SystemClock.sleep(100) }
        error("Timed out: $what")
    }
    private fun shell(ui: UiAutomation, command: String) { android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand(command)).use { it.readBytes() } }
    private fun fixture(server: String): JSONObject = Api.http.newCall(Request.Builder().url("$server/fixture/state").build()).execute().use { JSONObject(it.body!!.string()) }
    private fun screenshot(ui: UiAutomation, name: String) {
        SystemClock.sleep(150)
        waitFor("unobscured app window: $name") { ui.rootInActiveWindow?.packageName?.toString() == "com.beaconremote.host" }
        val image = checkNotNull(ui.takeScreenshot())
        val file = File(checkNotNull(targetContext.getExternalFilesDir("ui")), "$name.png")
        file.parentFile!!.mkdirs()
        FileOutputStream(file).use { check(image.compress(Bitmap.CompressFormat.PNG, 100, it)) }
        image.recycle()
    }
}

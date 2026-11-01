package com.beaconremote.host

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import org.webrtc.CapturerObserver
import org.webrtc.VideoFrame

/** Run only on the disposable, account-free emulator described in unattended-access.md. No network/media upload. */
class ScreenshotAcceptance : Instrumentation() {
    override fun onCreate(arguments: Bundle?) { super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        val identity = Identity(targetContext)
        var capturer: AccessibilityCapturer? = null
        var activity: Activity? = null
        var automation: android.app.UiAutomation? = null
        var resultCode = Activity.RESULT_CANCELED
        var factory: org.webrtc.PeerConnectionFactory? = null
        var video: org.webrtc.VideoSource? = null
        try {
            check(android.os.Build.VERSION.SDK_INT >= 30)
            check(android.os.Build.HARDWARE in listOf("ranchu", "goldfish")) { "This acceptance runner only changes settings on a disposable emulator" }
            check(!identity.paired) { "Acceptance requires an unpaired disposable emulator" }
            // Instrumentation must not suppress the actual accessibility service being exercised.
            val ui=getUiAutomation(android.app.UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES).also { automation=it }
            val enabled=android.provider.Settings.Secure.getString(targetContext.contentResolver, android.provider.Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES).orEmpty()
            check(enabled.split(':').filter { it.isNotBlank() }.all { android.content.ComponentName.unflattenFromString(it) == android.content.ComponentName(targetContext, ControlService::class.java) }) { "Emulator has another accessibility service; refusing to replace it" }
            // Starting instrumentation replaces the target process and invalidates its old binding.
            // Rebind through the system after the new process is alive, never by constructing a fake service.
            fun shell(command: String) { android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand(command)).use { it.readBytes() } }
            shell("settings delete secure enabled_accessibility_services")
            shell("settings put secure enabled_accessibility_services com.beaconremote.host/.ControlService")
            shell("settings put secure accessibility_enabled 1")
            shell("locksettings set-disabled false")
            activity = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            runOnMainSync { activity!!.setTurnScreenOn(true) }
            waitFor("accessibility service") { UnattendedAccess.ready(targetContext) }
            identity.unattended = true
            identity.wantsAvailable = true
            org.webrtc.PeerConnectionFactory.initialize(org.webrtc.PeerConnectionFactory.InitializationOptions.builder(targetContext).createInitializationOptions())
            factory=org.webrtc.PeerConnectionFactory.builder().createPeerConnectionFactory()
            val nativeSource=factory.createVideoSource(true).also {video=it}
            val allowed = AtomicBoolean(true)
            val frames = AtomicInteger()
            val failed = AtomicBoolean(false)
            val failure = java.util.concurrent.atomic.AtomicReference<String>()
            val source = AccessibilityCapturer(targetContext, { allowed.get() }, { failure.set(it); failed.set(true) }).also { capturer = it }
            val observer=object : CapturerObserver {
                override fun onCapturerStarted(success: Boolean) { check(success); nativeSource.capturerObserver.onCapturerStarted(success) }
                override fun onCapturerStopped() { nativeSource.capturerObserver.onCapturerStopped() }
                override fun onFrameCaptured(frame: VideoFrame) {
                    check(frame.buffer.width > 0 && frame.buffer.height > 0)
                    check(maxOf(frame.buffer.width, frame.buffer.height) <= 720)
                    check(frame.buffer.width % 2 == 0 && frame.buffer.height % 2 == 0)
                    nativeSource.capturerObserver.onFrameCaptured(frame)
                    frames.incrementAndGet()
                }
            }
            source.initialize(null, targetContext, observer)
            source.startCapture(720, 1280, 2)
            waitFor("real screenshot frame") { frames.get() > 0 || failed.get() }
            check(!failed.get()) { "Capture failed: ${failure.get()}" }
            allowed.set(false)
            SystemClock.sleep(750)
            val paused = frames.get()
            SystemClock.sleep(750)
            check(frames.get() == paused) { "Frames continued while paused" }
            allowed.set(true)
            waitFor("capture resume") { frames.get() > paused }
            identity.wantsAvailable = false
            waitFor("availability shutdown") { failed.get() }
            val unavailable = frames.get()
            SystemClock.sleep(750)
            check(frames.get() == unavailable) { "Frames continued after availability was stopped" }
            source.stopCapture()
            identity.wantsAvailable = true
            failed.set(false)
            source.startCapture(720,1280,2)
            waitFor("capture after availability resumes") { frames.get() > unavailable }
            identity.unattended = false
            waitFor("local revocation") { failed.get() }
            val revoked = frames.get()
            SystemClock.sleep(750)
            check(frames.get() == revoked) { "Frames continued after local revocation" }
            source.stopCapture()
            source.dispose()
            identity.unattended = true
            failed.set(false)
            val lockedSource=AccessibilityCapturer(targetContext, {true}, {failed.set(true)}).also {capturer=it}
            lockedSource.initialize(null,targetContext,observer)
            lockedSource.startCapture(720,1280,2)
            waitFor("fresh capture before lock") {frames.get()>revoked}
            runOnMainSync { activity!!.setTurnScreenOn(false) }
            check(ControlService.instance!!.performGlobalAction(android.accessibilityservice.AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN))
            waitFor("capture stops on lock") {failed.get()}
            val locked=frames.get()
            SystemClock.sleep(750)
            check(frames.get()==locked) {"Frames continued after screen lock"}
            result.putString("stream", "PASS: Android screenshot API, real WebRTC source, bounded frame size, pause/resume, availability shutdown, local revocation, lock-screen shutdown; no network or stored pixels\n")
            resultCode=Activity.RESULT_OK
        } catch (error: Throwable) {
            val keyguard=targetContext.getSystemService(android.app.KeyguardManager::class.java)
            result.putString("stream", "FAIL: ${error.message}; enabled=${ControlService.enabled(targetContext)}, bound=${ControlService.instance!=null}, notifications=${androidx.core.app.NotificationManagerCompat.from(targetContext).areNotificationsEnabled()}, locked=${keyguard.isKeyguardLocked}\n")
        } finally {
            capturer?.dispose()
            video?.dispose()
            factory?.dispose()
            identity.unattended = false
            identity.wantsAvailable = false
            activity?.let { screen -> runOnMainSync { screen.finish() } }
            automation?.let { ui -> android.os.ParcelFileDescriptor.AutoCloseInputStream(ui.executeShellCommand("wm dismiss-keyguard")).use { it.readBytes() } }
        }
        finish(resultCode,result)
    }
    private fun waitFor(what: String, condition: () -> Boolean) {
        val until = SystemClock.elapsedRealtime() + 15_000
        while (!condition() && SystemClock.elapsedRealtime() < until) SystemClock.sleep(100)
        check(condition()) { "Timed out waiting for $what" }
    }
}

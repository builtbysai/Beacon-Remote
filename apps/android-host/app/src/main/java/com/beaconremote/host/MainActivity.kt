package com.beaconremote.host

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/** Pairing and explicit, locally revocable owner access. */
class MainActivity : Activity() {
    private lateinit var identity: Identity
    private lateinit var root: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private var renderedPaired = false
    private var permissionStartsAvailability = false
    private val refreshTask = object : Runnable {
        override fun run() {
            if (isDestroyed || isFinishing) return
            if (renderedPaired != identity.paired) {
                if (identity.paired && notificationsReady()) runCatching { AvailabilityService.start(this@MainActivity) }
                render()
            }
            refreshStatus()
            handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        identity = Identity(this)
        root = HostUi.column(this)
        HostUi.screen(this, root)
        render()
        if (identity.paired && identity.wantsAvailable && notificationsReady()) AvailabilityService.start(this)
    }
    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refreshTask)
        refreshTask.run()
    }
    override fun onPause() {
        handler.removeCallbacks(refreshTask)
        super.onPause()
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }
    private fun label(value: String, size: Float = 15f, bold: Boolean = false) = HostUi.text(this, value, size, bold)
    private fun render() {
        renderedPaired = identity.paired
        root.removeAllViews()
        root.addView(label("Beacon Remote", 26f, true))
        if (renderedPaired) renderPaired() else renderPairing()
    }
    private fun field(title: String, input: EditText) {
        root.addView(label(title, 13f).apply { labelFor = input.id; setPadding(0, HostUi.dp(this@MainActivity, 8), 0, 0) })
        root.addView(input)
    }
    private fun input(idValue: Int, type: Int, limit: Int) = EditText(this).apply {
        id = idValue
        inputType = type
        filters = arrayOf(InputFilter.LengthFilter(limit))
        setSingleLine(true)
        minHeight = HostUi.dp(this@MainActivity, 52)
        textSize = 16f
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
    }
    private fun renderPairing() {
        root.addView(label("Pair this device", 20f, true))
        root.addView(HostUi.text(this, "In your workspace, choose Add a computer and enter its one-use code here.", secondary = true))
        val name = input(R.id.pair_name, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS, 80).apply { setText(Build.MODEL) }
        val code = input(R.id.pair_code, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_CHARACTERS or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 32).apply {
            hint = "ABCD-EFGH"
            imeOptions = EditorInfo.IME_ACTION_DONE
        }
        field("Device name", name)
        field("Pairing code", code)
        val server = input(R.id.pair_server, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI, 512).apply { setText("https://remote.builtbysai.com") }
        val serverLabel = label("Server address", 13f).apply { labelFor = server.id; visibility = View.GONE }
        server.visibility = View.GONE
        root.addView(HostUi.button(this, "Server address").apply {
            setOnClickListener {
                val visible = server.visibility != View.VISIBLE
                server.visibility = if (visible) View.VISIBLE else View.GONE
                serverLabel.visibility = server.visibility
            }
        })
        root.addView(serverLabel)
        root.addView(server)
        val message = label(pairingNotice.orEmpty(), 14f).apply { tag = "pair-notice"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val pair = HostUi.button(this, "Pair device", true).apply { tag = "pair-submit" }
        pair.setOnClickListener {
            val origin = Api.validServer(server.text.toString())
            val deviceName = name.text.toString().trim()
            val pairingCode = code.text.toString().trim().uppercase(Locale.ROOT)
            if (origin == null) { server.visibility = View.VISIBLE; serverLabel.visibility = View.VISIBLE; server.error = "Enter a server origin, such as https://remote.builtbysai.com"; server.requestFocus(); return@setOnClickListener }
            if (deviceName.isEmpty()) { name.error = "Enter a device name"; name.requestFocus(); return@setOnClickListener }
            if (pairingCode.isEmpty()) { code.error = "Enter the code from your workspace"; code.requestFocus(); return@setOnClickListener }
            if (!pairing.compareAndSet(false, true)) return@setOnClickListener
            pairingNotice = null
            listOf(server, name, code, pair).forEach { it.isEnabled = false }
            message.text = "Pairing…"
            thread(name = "pair-device") {
                val result = runCatching {
                    val (seed, publicKey) = identity.newKey()
                    try {
                        val machine = Api.enroll(origin, pairingCode, deviceName, publicKey)
                        identity.savePairing(origin, machine, deviceName, seed)
                    } finally { seed.fill(0) }
                }
                pairingNotice = result.exceptionOrNull()?.let { (it as? PairingFailed)?.message ?: "Could not reach the server. Try again." }
                pairing.set(false)
                handler.post {
                    if (!isDestroyed && !isFinishing) {
                        if (result.isSuccess) {
                            if (notificationsReady()) AvailabilityService.start(this)
                            render()
                        } else {
                            listOf(server, name, code, pair).forEach { it.isEnabled = true }
                            message.text = pairingNotice
                        }
                    }
                }
            }
        }
        code.setOnEditorActionListener { _, action, _ -> if (action == EditorInfo.IME_ACTION_DONE) { pair.performClick(); true } else false }
        root.addView(pair)
        root.addView(message)
        listOf(server, name, code, pair).forEach { it.isEnabled = !pairing.get() }
    }
    private fun notificationsReady() = NotificationManagerCompat.from(this).areNotificationsEnabled()
    private fun notificationSettings() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        } else startActivity(Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, packageName))
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == 1 && permissionStartsAvailability) {
            permissionStartsAvailability = false
            if (notificationsReady() && identity.paired) AvailabilityService.start(this)
        }
    }
    private fun stopCapture() { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP)) }
    private fun renderPaired() {
        root.addView(label(identity.name, 20f, true))
        root.addView(label(HostState.status).apply { tag = "status"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE })
        root.addView(HostUi.button(this, "Make available", true).apply {
            tag = "availability-toggle"
            setOnClickListener {
                if (identity.wantsAvailable) {
                    if (AccessIntents.fence.pending(identity.accessBinding())) runCatching { identity.unattended = false }
                    identity.wantsAvailable = false
                    stopCapture()
                    startService(Intent(this@MainActivity, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP))
                } else if (!notificationsReady()) {
                    permissionStartsAvailability = true
                    notificationSettings()
                } else AvailabilityService.start(this@MainActivity)
                refreshStatus()
            }
        })
        root.addView(label("Unattended access", 18f, true).apply { setPadding(0, HostUi.dp(this@MainActivity, 24), 0, HostUi.dp(this@MainActivity, 8)) })
        root.addView(HostUi.text(this, "Your account can connect without a prompt while this device is unlocked. Pause and Stop remain visible.", secondary = true))
        root.addView(HostUi.text(this, "Android 11+ · Up to 2 fps in unattended mode · No system audio", 13f, secondary = true))
        root.addView(HostUi.button(this, "Enable notifications").apply { tag = "notification-settings"; setOnClickListener { notificationSettings() } })
        root.addView(HostUi.button(this, "Enable accessibility").apply { tag = "accessibility-settings"; setOnClickListener { startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)) } })
        root.addView(HostUi.button(this, "Enable unattended access").apply { tag = "access-toggle"; setOnClickListener { changeAccess() } })
        root.addView(label("", 14f).apply { tag = "access-notice"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE })
        val server = HostUi.text(this, identity.server, 13f, secondary = true).apply { visibility = View.GONE }
        root.addView(HostUi.button(this, "Connection details").apply { setOnClickListener { server.visibility = if (server.visibility == View.VISIBLE) View.GONE else View.VISIBLE } })
        root.addView(server)
        root.addView(HostUi.button(this, "Remove device").apply {
            setTextColor(getColor(R.color.beacon_danger))
            setOnClickListener {
                AlertDialog.Builder(this@MainActivity).setTitle("Remove this device?")
                    .setMessage("This stops sharing and removes the local pairing. Remove its entry from your workspace separately.")
                    .setNegativeButton("Cancel", null).setPositiveButton("Remove") { _, _ -> unpair() }.show()
            }
        })
        refreshStatus()
    }
    private fun changeAccess() {
        val binding = identity.accessBinding()
        val enable = !identity.unattended && !AccessIntents.fence.pending(binding)
        if (enable && !notificationsReady()) { notificationSettings(); return }
        if (enable && !UnattendedAccess.ready(this)) { startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); return }
        if (!enable) {
            stopCapture()
            if (runCatching { identity.unattended = false }.isFailure) {
                ControlService.instance?.disableSelf()
                AccessIntents.notice = binding to "Sharing stopped. The local setting could not be saved; accessibility was disabled. Repair storage before enabling again."
                refreshStatus()
                return
            }
        }
        val ticket = AccessIntents.fence.begin(binding)
        AccessIntents.notice = null
        thread(name = "owner-access") {
            val result = runCatching {
                synchronized(Api) {
                    if (!AccessIntents.fence.current(ticket, identity.accessBinding())) return@synchronized false
                    Api.setAccess(identity, enable, binding)
                    val ready = !enable || UnattendedAccess.ready(applicationContext)
                    val applied = ready && identity.applyAccessIntent(ticket, enable)
                    if (!applied && identity.accessBinding() == binding && !identity.unattended) Api.setAccess(identity, false, binding, onlyIfLocallyDisabled = true)
                    applied
                }
            }
            if (AccessIntents.fence.current(ticket, identity.accessBinding())) {
                AccessIntents.notice = binding to if (result.getOrDefault(false)) {
                    if (identity.unattended) "Unattended access is enabled on this device." else "Unattended access is off."
                } else if (enable) "Could not enable access. Check the connection and required permissions, then retry."
                else "Off on this device. The workspace will be updated when connected."
            }
            AccessIntents.fence.finish(ticket)
            handler.post {
                if (!isDestroyed && !isFinishing) {
                    if (result.getOrDefault(false) && identity.wantsAvailable) AvailabilityService.start(this)
                    refreshStatus()
                }
            }
        }
        refreshStatus()
    }
    private fun refreshStatus() {
        if (!::root.isInitialized) return
        if (!identity.paired) {
            root.findViewWithTag<Button>("pair-submit")?.apply { text = if (pairing.get()) "Pairing…" else "Pair device"; isEnabled = !pairing.get() }
            root.findViewWithTag<TextView>("pair-notice")?.text = if (pairing.get()) "Pairing…" else pairingNotice.orEmpty()
            if (!pairing.get()) listOf(R.id.pair_name, R.id.pair_code, R.id.pair_server).forEach { root.findViewById<EditText>(it)?.isEnabled = true }
            return
        }
        root.findViewWithTag<TextView>("status")?.let { if (it.text.toString() != HostState.status) it.text = HostState.status }
        root.findViewWithTag<Button>("availability-toggle")?.text = if (identity.wantsAvailable) "Go offline" else "Make available"
        root.findViewWithTag<Button>("notification-settings")?.visibility = if (notificationsReady()) View.GONE else View.VISIBLE
        root.findViewWithTag<Button>("accessibility-settings")?.visibility = if (Build.VERSION.SDK_INT >= 30 && (!ControlService.enabled(this) || ControlService.instance == null)) View.VISIBLE else View.GONE
        root.findViewWithTag<Button>("access-toggle")?.apply {
            text = if (AccessIntents.fence.pending(identity.accessBinding())) "Cancel pending change" else if (identity.unattended) "Turn off unattended access" else "Enable unattended access"
            isEnabled = Build.VERSION.SDK_INT >= 30
        }
        root.findViewWithTag<TextView>("access-notice")?.apply {
            text = AccessIntents.notice?.takeIf { it.first == identity.accessBinding() }?.second.orEmpty()
            visibility = if (text.isEmpty()) View.GONE else View.VISIBLE
        }
    }
    private fun unpair() {
        stopCapture()
        startService(Intent(this, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP))
        identity.clear()
        AccessIntents.notice = null
        render()
    }
    private companion object {
        val pairing = AtomicBoolean(false)
        @Volatile var pairingNotice: String? = null
    }
}

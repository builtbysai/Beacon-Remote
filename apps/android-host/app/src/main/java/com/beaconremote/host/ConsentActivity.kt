package com.beaconremote.host

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationManagerCompat
import org.json.JSONObject

/**
 * The visible approval. Nothing is shared until the person taps Allow once here and then accepts Android's own
 * screen-capture prompt. Declining, closing or letting it expire tells the server no, and nothing is captured.
 */
class ConsentActivity : Activity() {
    private lateinit var grant: Grant
    private var answered = false
    private var awaitingCapture = false
    private var selectedControl = false
    private var selectedFiles = false
    private var expiresAt = 0L
    private lateinit var binding: AccessBinding
    private lateinit var scopeSummary: TextView
    private lateinit var allowButton: Button
    private lateinit var notificationNote: TextView
    private lateinit var notificationSettings: Button
    private var control: CheckBox? = null
    private var controlNote: TextView? = null
    private var controlSettings: Button? = null
    private var files: CheckBox? = null
    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val raw = intent.getStringExtra("grant")
        val identity = Identity(this)
        if (raw == null || !identity.paired) {
            finish()
            return
        }
        val parsed = runCatching { Grant.from(JSONObject(raw)) }.getOrNull()
        if (parsed == null) { finish(); return }
        grant = parsed
        binding = savedInstanceState?.let { AccessBinding(it.getString("server").orEmpty(), it.getString("machine").orEmpty()) } ?: identity.accessBinding()
        if (binding != identity.accessBinding()) { finish(); return }
        answered = savedInstanceState?.getBoolean("answered") == true
        if (answered) { finish(); return }
        awaitingCapture = savedInstanceState?.getBoolean("awaiting") == true
        selectedControl = savedInstanceState?.getBoolean("selectedControl") == true
        selectedFiles = savedInstanceState?.getBoolean("selectedFiles") == true
        expiresAt = savedInstanceState?.getLong("deadline") ?: (SystemClock.elapsedRealtime() + 110_000)
        getSystemService(NotificationManager::class.java).cancel(2)
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val layout = HostUi.column(this)
        layout.addView(HostUi.text(this, "Beacon Remote", 15f, true, true))
        layout.addView(
            TextView(this).apply {
                text = "Request to see your screen"
                textSize = 24f
                typeface = Typeface.DEFAULT_BOLD
            },
        )
        layout.addView(
            TextView(this).apply {
                text = grant.controller
                textSize = 17f
                setPadding(0, dp(16), 0, dp(4))
                typeface = Typeface.DEFAULT_BOLD
            },
        )
        layout.addView(
            TextView(this).apply {
                text =
                    if (grant.capability == "desktop:control") {
                        "wants to see this screen, and asked to control it."
                    } else {
                        "wants to see this screen."
                    }
                textSize = 16f
            },
        )
        if (grant.capability == "desktop:control") {
            control =
                CheckBox(this).apply {
                    text = "Also let them touch and type on this phone"
                    textSize = 16f
                    isChecked = savedInstanceState?.getBoolean("control") == true
                    minHeight = dp(48)
                }
            controlNote = TextView(this).apply { textSize = 13f }
            controlSettings =
                Button(this).apply {
                    text = "Turn on control in Settings"
                    setOnClickListener { startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
                }
            layout.addView(control)
            layout.addView(controlNote)
            layout.addView(controlSettings)
        }
        if (FileReceiver.supported) {
            files =
                CheckBox(this).apply {
                    text = "Also allow receiving files (saved in Downloads/Beacon Remote)"
                    textSize = 16f
                    isChecked = savedInstanceState?.getBoolean("files") == true
                    minHeight = dp(48)
                }
            layout.addView(files)
        }
        layout.addView(
            TextView(this).apply {
                text =
                    "Android will ask you to confirm screen capture. Pause and Stop stay visible while sharing."
                textSize = 14f
                setPadding(0, dp(20), 0, dp(24))
            },
        )
        notificationNote = HostUi.text(this, "", 14f).apply { accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE }
        notificationSettings = HostUi.button(this, "Enable sharing notifications").apply {
            setOnClickListener { startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, packageName)) }
        }
        layout.addView(notificationNote)
        layout.addView(notificationSettings)
        val buttons = LinearLayout(this).apply {
            gravity = Gravity.END
            val horizontal = maxOf(20, (resources.configuration.screenWidthDp - 600) / 2)
            setPadding(dp(horizontal), dp(8), dp(horizontal), dp(8))
            setBackgroundColor(getColor(R.color.beacon_surface))
        }
        buttons.addView(
            HostUi.button(this, "Decline").apply {
                tag = "consent-decline"
                setOnClickListener { decline() }
            },
            LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f),
        )
        allowButton = HostUi.button(this, "Allow once", true).apply { tag = "consent-allow"; setOnClickListener { allow() } }
        buttons.addView(allowButton, LinearLayout.LayoutParams(0, android.view.ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        scopeSummary = HostUi.text(this, "View only", 14f, true).apply {
            gravity = Gravity.CENTER
            accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        val footer = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.beacon_surface))
            addView(scopeSummary)
            addView(buttons)
        }
        control?.setOnCheckedChangeListener { _, _ -> refreshScope() }
        files?.setOnCheckedChangeListener { _, _ -> refreshScope() }
        HostUi.screen(this, layout, footer)
        refreshControl()
        // The request expires on the server after two minutes.
        handler.postDelayed({ decline() }, maxOf(0, expiresAt - SystemClock.elapsedRealtime()))
    }

    override fun onResume() {
        super.onResume()
        if (::allowButton.isInitialized) refreshControl()
    }

    override fun onSaveInstanceState(state: Bundle) {
        super.onSaveInstanceState(state)
        if (!::binding.isInitialized) return
        state.putString("server", binding.server)
        state.putString("machine", binding.machineId)
        state.putLong("deadline", expiresAt)
        state.putBoolean("answered", answered)
        state.putBoolean("awaiting", awaitingCapture)
        state.putBoolean("selectedControl", selectedControl)
        state.putBoolean("selectedFiles", selectedFiles)
        state.putBoolean("control", control?.isChecked == true)
        state.putBoolean("files", files?.isChecked == true)
    }
    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        if (isFinishing && ::grant.isInitialized && ::binding.isInitialized && !answered) decline()
        super.onDestroy()
    }

    /** Control needs the accessibility service the person turns on in Settings; until then the box stays off. */
    private fun refreshControl() {
        val notifications = NotificationManagerCompat.from(this).areNotificationsEnabled()
        notificationNote.text = if (!notifications) "Enable notifications so Pause and Stop stay available while sharing." else if (awaitingCapture) "Waiting for Android’s screen-capture permission…" else ""
        notificationNote.visibility = if (notificationNote.text.isEmpty()) android.view.View.GONE else android.view.View.VISIBLE
        notificationSettings.visibility = if (notifications) android.view.View.GONE else android.view.View.VISIBLE
        allowButton.isEnabled = !answered && !awaitingCapture && notifications
        files?.isEnabled = !awaitingCapture
        refreshScope()
        val box = control ?: return
        val on = ControlService.enabled(this) && ControlService.instance != null
        box.isEnabled = on && !awaitingCapture
        if (!on) box.isChecked = false
        controlNote?.text =
            if (on) "Off unless you tick it. You can pause or stop at any time."
            else "Control needs Beacon Remote's accessibility service. Turn it on once in Settings; it does nothing outside a session you approve."
        controlSettings?.visibility = if (on) android.view.View.GONE else android.view.View.VISIBLE
        controlSettings?.isEnabled = !awaitingCapture
    }

    private fun refreshScope() {
        if (!::scopeSummary.isInitialized) return
        val withControl = if (awaitingCapture) selectedControl else control?.isChecked == true
        val withFiles = if (awaitingCapture) selectedFiles else files?.isChecked == true
        scopeSummary.text = (if (withControl) "View and control" else "View only") + (if (withFiles) " � Receive files" else "")
    }

    private fun allow() {
        if (answered || awaitingCapture) return
        if (SystemClock.elapsedRealtime() >= expiresAt || Identity(this).accessBinding() != binding) { decline(); return }
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) { refreshControl(); return }
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        if (manager == null) { notificationNote.text = "Screen sharing is unavailable on this device."; notificationNote.visibility = android.view.View.VISIBLE; return }
        selectedControl = control?.isChecked == true
        selectedFiles = files?.isChecked == true
        awaitingCapture = true
        refreshControl()
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE)
        } catch (_: Exception) {
            awaitingCapture = false
            refreshControl()
            notificationNote.text = "Android could not open screen-capture permission. Retry or decline."
            notificationNote.visibility = android.view.View.VISIBLE
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        awaitingCapture = false
        if (resultCode == RESULT_OK && data != null && !answered && SystemClock.elapsedRealtime() < expiresAt && Identity(this).accessBinding() == binding && NotificationManagerCompat.from(this).areNotificationsEnabled()) {
            answered = true
            handler.removeCallbacksAndMessages(null)
            startForegroundService(
                Intent(this, CaptureService::class.java)
                    .putExtra("grant", intent.getStringExtra("grant"))
                    .putExtra("data", data)
                    .putExtra("control", selectedControl)
                    .putExtra("files", selectedFiles),
            )
            finish()
        } else {
            decline()
        }
    }

    private fun decline() {
        if (answered) return
        answered = true
        handler.removeCallbacksAndMessages(null)
        if (::grant.isInitialized && ::binding.isInitialized) runCatching { ShareSession(applicationContext, grant, binding.server, null) {}.decline() }
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        decline()
    }

    private companion object {
        const val REQUEST_CAPTURE = 7
    }
}

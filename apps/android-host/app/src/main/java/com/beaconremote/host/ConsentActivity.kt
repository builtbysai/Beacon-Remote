package com.beaconremote.host

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.graphics.Typeface
import android.media.projection.MediaProjectionConfig
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.util.Log
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.widget.Button
import android.widget.CheckBox
import android.widget.LinearLayout
import android.widget.TextView
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
        val request = currentRequest(intent) ?: run { finish(); return }
        grant = request.first
        binding = request.second
        if (savedInstanceState != null && savedInstanceState.getString("requestId") != grant.id) {
            finish()
            return
        }
        answered = savedInstanceState?.getBoolean("answered") == true
        if (answered) { finish(); return }
        awaitingCapture = savedInstanceState?.getBoolean("awaiting") == true
        selectedControl = savedInstanceState?.getBoolean("selectedControl") == true
        selectedFiles = savedInstanceState?.getBoolean("selectedFiles") == true
        expiresAt = intent.getLongExtra("deadline", 0)
        if (SystemClock.elapsedRealtime() >= expiresAt) { decline(); return }
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
                    // They asked for control, so it starts selected; nothing is shared until Allow once, and
                    // the box clears itself when the accessibility service that performs it is off.
                    isChecked = savedInstanceState?.getBoolean("control") ?: true
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
            setOnClickListener { startActivity(SharingNotifications.settings(this@ConsentActivity)) }
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
        // The accessibility service can connect a moment after this screen opens; keep the control box in step with it.
        handler.post(refreshControlTick)
        // The request expires on the server after two minutes.
        handler.postDelayed({ decline() }, maxOf(0, expiresAt - SystemClock.elapsedRealtime()))
    }

    private val refreshControlTick = object : Runnable {
        override fun run() {
            if (answered || isFinishing) return
            refreshControl()
            handler.postDelayed(this, 500)
        }
    }

    override fun onResume() {
        super.onResume()
        if (::allowButton.isInitialized) refreshControl()
    }

    private fun currentRequest(delivered: Intent): Pair<Grant, AccessBinding>? {
        val identity = Identity(this)
        val binding = delivered.accessBinding() ?: return null
        if (!identity.paired || identity.accessBinding() != binding) return null
        val raw = delivered.getStringExtra("grant") ?: return null
        val grant = runCatching { Grant.from(JSONObject(raw)) }.getOrNull() ?: return null
        return grant to binding
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val replacement = currentRequest(intent) ?: return
        if (::grant.isInitialized && replacement.first.id == grant.id) return
        if (SystemClock.elapsedRealtime() >= intent.getLongExtra("deadline", 0)) return
        // Finish the old Activity before launching the new approval. Android's
        // capture result belongs to the old Activity and cannot approve this request.
        decline()
        finish()
        startActivity(intent)
    }

    override fun onSaveInstanceState(state: Bundle) {
        super.onSaveInstanceState(state)
        if (!::binding.isInitialized) return
        state.putString("requestId", grant.id)
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
        val notifications = SharingNotifications.ready(this)
        notificationNote.text = if (!notifications) "Enable notifications so Pause and Stop stay available while sharing." else if (awaitingCapture) "Waiting for Android’s screen-capture permission…" else ""
        notificationNote.visibility = if (notificationNote.text.isEmpty()) android.view.View.GONE else android.view.View.VISIBLE
        notificationSettings.visibility = if (notifications) android.view.View.GONE else android.view.View.VISIBLE
        allowButton.isEnabled = !answered && !awaitingCapture && notifications
        files?.isEnabled = !awaitingCapture
        refreshScope()
        val box = control ?: return
        val on = ControlService.enabled(this) && ControlService.instance != null
        Log.i("BeaconHost", "Consent control state: enabled=${ControlService.enabled(this)} instance=${ControlService.instance != null} awaiting=$awaitingCapture")
        box.isEnabled = on && !awaitingCapture
        // Clear the box only when the service is really off in Settings. The live instance can be missing for a moment
        // at startup, and clearing on that moment would leave control unticked after the service connects.
        if (!ControlService.enabled(this)) box.isChecked = false
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
        scopeSummary.text = (if (withControl) "View and control" else "View only") + (if (withFiles) " · Receive files" else "")
    }

    private fun allow() {
        if (answered || awaitingCapture) return
        if (SystemClock.elapsedRealtime() >= expiresAt || !mayShare()) { decline(); return }
        if (!SharingNotifications.ready(this)) { refreshControl(); return }
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        if (manager == null) { notificationNote.text = "Screen sharing is unavailable on this device."; notificationNote.visibility = android.view.View.VISIBLE; return }
        selectedControl = control?.isChecked == true
        selectedFiles = files?.isChecked == true
        awaitingCapture = true
        refreshControl()
        try {
            // Remote viewing is of the whole screen. Android 14 and later would otherwise open on "Share one
            // app", which needs an extra choice and cannot be remote-controlled; ask for the whole screen only.
            val capture = if (Build.VERSION.SDK_INT >= 34) {
                manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
            } else {
                manager.createScreenCaptureIntent()
            }
            @Suppress("DEPRECATION")
            startActivityForResult(capture, REQUEST_CAPTURE)
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
        if (requestCode != REQUEST_CAPTURE || !awaitingCapture || answered) return
        awaitingCapture = false
        if (resultCode == RESULT_OK && data != null && SystemClock.elapsedRealtime() < expiresAt && mayShare() && SharingNotifications.ready(this)) {
            answered = true
            handler.removeCallbacksAndMessages(null)
            startForegroundService(
                Intent(this, CaptureService::class.java)
                    .withAccessBinding(binding)
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

    private fun mayShare(): Boolean = Identity(this).let {
        it.paired && it.wantsAvailable && it.accessBinding() == binding
    }

    private fun decline() {
        if (answered) return
        answered = true
        if (awaitingCapture) {
            awaitingCapture = false
            finishActivity(REQUEST_CAPTURE)
        }
        handler.removeCallbacksAndMessages(null)
        if (::grant.isInitialized && ::binding.isInitialized) runCatching { ShareSession(applicationContext, grant, binding.server, null) {}.decline() }
        finish()
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        decline()
    }

    companion object {
        private const val REQUEST_CAPTURE = 7

        internal fun requestIntent(context: Context, grant: JSONObject, binding: AccessBinding): Intent {
            val maximum = 110_000L
            val now = System.currentTimeMillis()
            val serverDeadline = grant.optLong("approvalExpiresAtMillis", now + maximum)
            val remaining = serverDeadline.coerceIn(now, now + maximum) - now
            return Intent(context, ConsentActivity::class.java)
                .withAccessBinding(binding)
                .putExtra("grant", grant.toString())
                .putExtra("deadline", SystemClock.elapsedRealtime() + remaining)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        }
    }
}

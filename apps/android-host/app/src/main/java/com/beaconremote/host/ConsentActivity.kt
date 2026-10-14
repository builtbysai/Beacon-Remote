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
        grant = Grant.from(JSONObject(raw))
        getSystemService(NotificationManager::class.java).cancel(2)
        val density = resources.displayMetrics.density
        fun dp(value: Int) = (value * density).toInt()
        val layout =
            LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(24), dp(48), dp(24), dp(24))
            }
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
                    isChecked = false
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
                    isChecked = false
                }
            layout.addView(files)
        }
        layout.addView(
            TextView(this).apply {
                text =
                    "Android will ask you to confirm. While sharing, a notification stays on screen with Pause and Stop, " +
                        "and you can stop at any time."
                textSize = 14f
                setPadding(0, dp(20), 0, dp(24))
            },
        )
        val buttons = LinearLayout(this).apply { gravity = Gravity.END }
        buttons.addView(
            Button(this).apply {
                text = "Decline"
                setOnClickListener { decline() }
            },
        )
        buttons.addView(
            Button(this).apply {
                text = "Allow once"
                setOnClickListener { allow() }
            },
        )
        layout.addView(buttons)
        setContentView(layout)
        refreshControl()
        // The request expires on the server after two minutes.
        handler.postDelayed({ decline() }, 110_000)
    }

    override fun onResume() {
        super.onResume()
        refreshControl()
    }

    /** Control needs the accessibility service the person turns on in Settings; until then the box stays off. */
    private fun refreshControl() {
        val box = control ?: return
        val on = ControlService.enabled(this) && ControlService.instance != null
        box.isEnabled = on
        if (!on) box.isChecked = false
        controlNote?.text =
            if (on) "Off unless you tick it. You can pause or stop at any time."
            else "Control needs Beacon Remote's accessibility service. Turn it on once in Settings; it does nothing outside a session you approve."
        controlSettings?.visibility = if (on) android.view.View.GONE else android.view.View.VISIBLE
    }

    private fun allow() {
        if (answered) return
        val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        @Suppress("DEPRECATION")
        startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CAPTURE)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_CAPTURE) return
        android.util.Log.i("BeaconHost", "Capture prompt result: $resultCode data=${data != null}")
        if (resultCode == RESULT_OK && data != null && !answered) {
            answered = true
            handler.removeCallbacksAndMessages(null)
            startForegroundService(
                Intent(this, CaptureService::class.java)
                    .putExtra("grant", intent.getStringExtra("grant"))
                    .putExtra("data", data)
                    .putExtra("control", control?.isChecked == true)
                    .putExtra("files", files?.isChecked == true),
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
        ShareSession(applicationContext, grant, Identity(this).server, null) {}.decline()
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

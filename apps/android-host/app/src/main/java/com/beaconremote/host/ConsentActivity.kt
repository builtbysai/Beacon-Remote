package com.beaconremote.host

import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
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
                        "wants to see this screen. Control of this phone is not available, so they can only watch."
                    } else {
                        "wants to see this screen."
                    }
                textSize = 16f
            },
        )
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
        // The request expires on the server after two minutes.
        handler.postDelayed({ decline() }, 110_000)
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
                    .putExtra("data", data),
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

package com.beaconremote.host

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.concurrent.thread

/** Pair this phone with a Beacon Remote account, and start or stop being available. */
class MainActivity : Activity() {
    private lateinit var identity: Identity
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var root: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        identity = Identity(this)
        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        root = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val pad = (24 * resources.displayMetrics.density).toInt()
        root.setPadding(pad, pad * 2, pad, pad)
        setContentView(root)
        render()
        if (identity.paired && identity.wantsAvailable) AvailabilityService.start(this)
    }

    override fun onResume() {
        super.onResume()
        refresh()
    }

    override fun onPause() {
        handler.removeCallbacksAndMessages(null)
        super.onPause()
    }

    private fun label(value: String, size: Float = 16f, bold: Boolean = false) =
        TextView(this).apply {
            text = value
            textSize = size
            if (bold) typeface = Typeface.DEFAULT_BOLD
            setPadding(0, 0, 0, (12 * resources.displayMetrics.density).toInt())
        }

    private fun render() {
        root.removeAllViews()
        root.addView(label("Beacon Remote", 26f, true))
        if (!identity.paired) renderPairing() else renderPaired()
    }

    private fun renderPairing() {
        root.addView(
            label(
                "Pair this phone so you can reach its screen from the web. In your workspace choose " +
                    "Add a computer, then enter the code here within five minutes.",
            ),
        )
        val server =
            EditText(this).apply {
                hint = "Server"
                setText("https://remote.builtbysai.com")
                inputType = InputType.TYPE_TEXT_VARIATION_URI
            }
        val name = EditText(this).apply {
            hint = "Name"
            setText(Build.MODEL)
        }
        val code =
            EditText(this).apply {
                hint = "One-use pairing code"
                inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
            }
        val message = label("")
        val pair = Button(this).apply { text = "Pair this phone" }
        pair.setOnClickListener {
            val origin = Api.validServer(server.text.toString())
            if (origin == null || code.text.isBlank() || name.text.isBlank()) {
                message.text = "Check the server address, a name and the code."
                return@setOnClickListener
            }
            pair.isEnabled = false
            message.text = "Pairing…"
            thread {
                val result =
                    runCatching {
                        val (seed, publicKey) = identity.newKey()
                        val id = Api.enroll(origin, code.text.toString(), name.text.toString(), publicKey)
                        identity.savePairing(origin, id, name.text.toString().trim(), seed)
                    }
                handler.post {
                    result
                        .onSuccess {
                            AvailabilityService.start(this)
                            render()
                        }
                        .onFailure {
                            pair.isEnabled = true
                            message.text = (it as? PairingFailed)?.message ?: "Could not reach the server."
                        }
                }
            }
        }
        listOf(server, name, code, pair, message).forEach { root.addView(it) }
    }

    private fun renderPaired() {
        root.addView(label(identity.name, 20f, true))
        root.addView(label("Paired to ${identity.server}"))
        root.addView(label("", 16f).also { it.tag = "status" })
        root.addView(
            Button(this).apply {
                text = "Start being available"
                setOnClickListener { AvailabilityService.start(this@MainActivity) }
            },
        )
        root.addView(
            Button(this).apply {
                text = "Stop being available"
                setOnClickListener {
                    startService(
                        Intent(this@MainActivity, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP),
                    )
                }
            },
        )
        root.addView(
            Button(this).apply {
                text = "Remove this phone"
                setOnClickListener { unpair() }
            },
        )
        root.addView(label("Removing this phone here does not delete it from your workspace; remove it there too.", 13f))
        refresh()
    }

    private fun refresh() {
        root.findViewWithTag<TextView>("status")?.text = "Status: ${HostState.status}"
        handler.removeCallbacksAndMessages(null)
        handler.postDelayed({ refresh() }, 1000)
    }

    private fun unpair() {
        startService(Intent(this, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP))
        identity.clear()
        render()
    }
}

package com.beaconremote.host

import android.Manifest
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Color
import androidx.core.view.ViewCompat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.widget.Button
import android.widget.EditText
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import androidx.core.app.NotificationManagerCompat
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

/**
 * The phone's own screens: pairing, then three tabs (Device, Access, Privacy). All the same rules as before apply:
 * access without asking, unlocking, sound and the microphone are owner switches on this phone, and nothing here
 * can be turned on from a viewer.
 */
class MainActivity : Activity() {
    private lateinit var identity: Identity
    private lateinit var root: LinearLayout
    private lateinit var nav: LinearLayout
    private lateinit var moreButton: TextView
    private val navItems = LinkedHashMap<String, LinearLayout>()
    private val handler = Handler(Looper.getMainLooper())
    private var renderedPaired = false
    private var permissionStartsAvailability = false
    private var signature = ""
    // Guided setup: after a step the person is sent to Android for, the next one starts by itself on return.
    private var guidedFrom: String? = null
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

    private fun dp(value: Int) = HostUi.dp(this, value)
    private fun color(id: Int) = getColor(id)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        SharingNotifications.register(this)
        identity = Identity(this)
        root = HostUi.column(this)
        moreButton = TextView(this).apply {
            text = "⋯"
            textSize = 24f
            gravity = Gravity.CENTER
            contentDescription = "More options"
            tag = "more-options"
            setTextColor(color(R.color.beacon_text))
            HostUi.role(this, Button::class.java.name)
            setOnClickListener { showMenu() }
        }
        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            val horizontal = maxOf(22, (resources.configuration.screenWidthDp - 600) / 2)
            setPadding(dp(horizontal), dp(8), dp(horizontal - 8), dp(4))
            addView(HostUi.brand(this@MainActivity), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(moreButton, LinearLayout.LayoutParams(dp(48), dp(48)))
        }
        nav = buildNav()
        HostUi.screen(this, root, nav, header)
        render()
        prefillFromLink(intent)
        if (identity.paired && identity.wantsAvailable && notificationsReady()) AvailabilityService.start(this)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        prefillFromLink(intent)
    }

    /** A pairing link (beaconremote://pair?code=...) fills in the code. The person still taps Pair, so a link alone never pairs. */
    private fun prefillFromLink(link: Intent?) {
        val uri = link?.data ?: return
        if (uri.scheme != "beaconremote" || uri.host != "pair" || identity.paired) return
        applyPairing(uri.getQueryParameter("code")?.take(32), uri.getQueryParameter("server"))
    }

    /** Puts a code (and the workspace address, when known) into the pairing form. The person still taps Pair. */
    private fun applyPairing(code: String?, server: String?) {
        code?.let { root.findViewById<EditText>(R.id.pair_code)?.setText(it) }
        server?.let { address ->
            Api.validServer(address)?.let { origin -> root.findViewById<EditText>(R.id.pair_server)?.apply { setText(origin) } }
        }
    }

    /** Google's QR scanner: it needs no camera permission here. A scanned pairing link fills the form and pairs at once. */
    private fun scanPairingQr() {
        val options = com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions.Builder()
            .setBarcodeFormats(com.google.mlkit.vision.barcode.common.Barcode.FORMAT_QR_CODE)
            .build()
        com.google.mlkit.vision.codescanner.GmsBarcodeScanning.getClient(this, options).startScan()
            .addOnSuccessListener { barcode ->
                val parsed = PairingText.parse(barcode.rawValue)
                if (parsed == null) {
                    Toast.makeText(this, "That is not a Beacon pairing code.", Toast.LENGTH_LONG).show()
                } else {
                    applyPairing(parsed.code, parsed.server)
                    root.findViewWithTag<Button>("pair-submit")?.performClick()
                }
            }
            .addOnFailureListener { Toast.makeText(this, "Could not scan. Use Paste code instead.", Toast.LENGTH_LONG).show() }
    }

    // The phone's own code: shown here, typed into the signed-in workspace, approved there.
    private var deviceCode: Api.DevicePairing? = null
    private var deviceCodeSeed: ByteArray? = null
    @Volatile private var deviceCodeActive = false

    private fun startDeviceCode(origin: String, deviceName: String) {
        if (!pairing.compareAndSet(false, true)) return
        pairingNotice = null
        thread(name = "device-code") {
            val started = runCatching {
                val (seed, publicKey) = identity.newKey()
                deviceCodeSeed = seed
                Api.startDevicePairing(origin, deviceName, publicKey)
            }
            handler.post {
                if (isDestroyed || isFinishing) return@post
                val code = started.getOrNull()
                if (code == null) {
                    deviceCodeSeed?.fill(0); deviceCodeSeed = null
                    pairing.set(false)
                    pairingNotice = (started.exceptionOrNull() as? PairingFailed)?.message ?: "Could not reach the server. Try again."
                    render()
                    return@post
                }
                deviceCode = code
                deviceCodeActive = true
                renderDeviceCode(origin, deviceName, code)
                pollDeviceCode(origin, deviceName, code)
            }
        }
    }

    private fun renderDeviceCode(origin: String, deviceName: String, code: Api.DevicePairing) {
        root.removeAllViews()
        root.addView(Character(this, Character.Tone.BLUE, Character.Mood.WAVE), LinearLayout.LayoutParams(dp(84), dp(88)).apply { topMargin = dp(12) })
        root.addView(HostUi.kicker(this, "Type this code in your workspace"))
        root.addView(HostUi.headline(this, code.userCode).apply { typeface = HostUi.mono(context); letterSpacing = 0.02f })
        root.addView(HostUi.text(this, "On a computer, open ${origin.removePrefix("https://")}, sign in, choose Add a computer, and type this code. Then approve $deviceName.", 15f, false, true).apply { setPadding(0, dp(8), 0, dp(16)) })
        root.addView(HostUi.text(this, "Waiting for you to approve it…", 15f, true).apply { tag = "device-code-status"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE })
        root.addView(HostUi.button(this, "Cancel").apply {
            setOnClickListener { stopDeviceCode(); render() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(22) })
    }

    private fun stopDeviceCode() {
        deviceCodeActive = false
        deviceCode = null
        deviceCodeSeed?.fill(0); deviceCodeSeed = null
        pairing.set(false)
    }

    private fun pollDeviceCode(origin: String, deviceName: String, code: Api.DevicePairing) {
        thread(name = "device-code-poll") {
            val deadline = System.currentTimeMillis() + code.expiresInSeconds * 1000L
            var failure: String? = null
            var machineId: String? = null
            while (deviceCodeActive && machineId == null && System.currentTimeMillis() < deadline) {
                try {
                    machineId = Api.pollDevicePairing(origin, code.pollToken)
                } catch (error: PairingFailed) {
                    failure = error.message; break
                } catch (_: Exception) { /* the network blinked: keep trying until the code expires */ }
                if (machineId == null) Thread.sleep(2000)
            }
            handler.post {
                if (isDestroyed || isFinishing || !deviceCodeActive) return@post
                val seed = deviceCodeSeed
                if (machineId != null && seed != null) {
                    runCatching { identity.savePairing(origin, machineId, deviceName, seed) }
                    stopDeviceCode()
                    if (notificationsReady()) AvailabilityService.start(this)
                    guidedFrom = ""
                    render()
                    handler.postDelayed({ continueGuidedSetup() }, 400)
                } else {
                    stopDeviceCode()
                    pairingNotice = failure ?: "That code expired. Try again."
                    render()
                }
            }
        }
    }

    private fun pasteFromClipboard() {
        val text = getSystemService(ClipboardManager::class.java).primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
        val parsed = PairingText.parse(text)
        if (parsed == null) {
            Toast.makeText(this, "Nothing to paste. In your workspace choose Add a computer, then Copy code or Copy link.", Toast.LENGTH_LONG).show()
            return
        }
        applyPairing(parsed.code, parsed.server)
        root.findViewWithTag<TextView>("pair-notice")?.text = "Code pasted. Tap Pair device."
    }

    // Smooth video comes with connecting without asking. Android needs one tap on its own prompt after each restart of
    // the app or the phone, so it is offered here once per launch instead of being a setting to choose.
    private var fastAsked = false
    private var audioAsked = false

    private fun resumeFastVideo() {
        if (fastAsked || !identity.paired || !identity.unattended || StandingScreen.active) return
        if (Build.VERSION.SDK_INT < 30) return
        // Hearing the phone's sound needs Android's audio-capture permission; it is asked for first, then smooth video.
        if (!audioAsked && checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            audioAsked = true
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2)
            return
        }
        fastAsked = true
        val manager = getSystemService(android.media.projection.MediaProjectionManager::class.java)
        // Android 14+ offers "Share one app" by default; smooth video needs the whole screen.
        val ask = if (Build.VERSION.SDK_INT >= 34) manager.createScreenCaptureIntent(android.media.projection.MediaProjectionConfig.createConfigForDefaultDisplay()) else manager.createScreenCaptureIntent()
        @Suppress("DEPRECATION")
        startActivityForResult(ask, REQUEST_FAST)
    }

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refreshTask)
        refreshTask.run()
        continueGuidedSetup()
        finishAccessIfWanted()
        handler.postDelayed({ if (!isDestroyed && !isFinishing) resumeFastVideo() }, 1200)
    }

    /** Back from an Android settings screen: if that step got done, go straight to the next one. */
    private fun continueGuidedSetup() {
        val from = guidedFrom ?: return
        if (!identity.paired) { guidedFrom = null; return }
        val next = setupSteps().firstOrNull { !it.done }
        if (next == null) { guidedFrom = null; finishAccessIfWanted(); return }
        if (next.title == from) { guidedFrom = null; return }
        guidedFrom = next.title
        handler.postDelayed({ if (!isDestroyed && !isFinishing) next.action() }, 500)
    }

    override fun onPause() {
        handler.removeCallbacks(refreshTask)
        super.onPause()
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    // ---- Frame -------------------------------------------------------------------------------------------------

    private fun buildNav(): LinearLayout {
        val bar = LinearLayout(this).apply { setPadding(dp(12), dp(6), dp(12), dp(6)) }
        for ((id, label, icon) in listOf(
            Triple("device", "Device", R.drawable.ic_nav_device),
            Triple("access", "Access", R.drawable.ic_nav_access),
            Triple("privacy", "Privacy", R.drawable.ic_nav_privacy),
        )) {
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                tag = "nav-$id"
                contentDescription = label
                minimumHeight = dp(56)
                isFocusable = true
                setPadding(0, dp(7), 0, dp(7))
                addView(ImageView(context).apply { setImageResource(icon); tag = "icon" }, LinearLayout.LayoutParams(dp(22), dp(22)))
                addView(TextView(context).apply {
                    text = label
                    textSize = 12f
                    typeface = HostUi.bold(context)
                    gravity = Gravity.CENTER
                    setPadding(0, dp(3), 0, 0)
                    tag = "label"
                })
                setOnClickListener { selectPage(id) }
            }
            navItems[id] = item
            bar.addView(item, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(3); marginEnd = dp(3) })
        }
        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(color(R.color.beacon_background))
            addView(HostUi.divider(this@MainActivity))
            addView(bar)
        }
    }

    private fun selectPage(id: String) {
        if (!identity.paired) return
        val changed = page != id
        page = id
        render()
        // A new tab starts at its top; a refresh of the same tab keeps the person's place.
        if (changed) (root.parent as? android.widget.ScrollView)?.let { scroll -> scroll.post { scroll.scrollTo(0, 0) } }
    }

    private fun updateNav() {
        for ((id, item) in navItems) {
            val selected = id == page
            val tint = ColorStateList.valueOf(color(if (selected) R.color.beacon_text else R.color.beacon_muted))
            item.background = if (selected) HostUi.tile(this, color(R.color.beacon_tile), 20) else null
            item.isSelected = selected
            // TalkBack: "Device, tab, selected".
            HostUi.role(item, Button::class.java.name, selected = selected, roleDescription = "Tab")
            item.findViewWithTag<ImageView>("icon").imageTintList = tint
            item.findViewWithTag<TextView>("label").setTextColor(tint)
        }
    }

    private fun render() {
        renderedPaired = identity.paired
        root.removeAllViews()
        nav.visibility = if (renderedPaired) View.VISIBLE else View.GONE
        moreButton.visibility = if (renderedPaired) View.VISIBLE else View.GONE
        if (!renderedPaired) {
            renderPairing()
        } else {
            when (page) {
                "access" -> renderAccess()
                "privacy" -> renderPrivacy()
                else -> renderDevice()
            }
            updateNav()
        }
        signature = currentSignature()
    }

    // ---- Pairing -----------------------------------------------------------------------------------------------

    private fun fieldBox(idValue: Int, type: Int, limit: Int) = EditText(this).apply {
        id = idValue
        inputType = type
        filters = arrayOf(InputFilter.LengthFilter(limit))
        setSingleLine(true)
        minHeight = dp(52)
        textSize = 16f
        typeface = HostUi.font(context, 400)
        setTextColor(color(R.color.beacon_text))
        setHintTextColor(color(R.color.beacon_muted))
        background = HostUi.rounded(this@MainActivity, color(R.color.beacon_surface), 16, color(R.color.beacon_line_strong))
        setPadding(dp(16), dp(10), dp(16), dp(10))
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
    }

    private fun field(title: String, input: EditText) {
        root.addView(HostUi.text(this, title, 15f, true).apply {
            labelFor = input.id
            setPadding(0, dp(16), 0, dp(8))
        })
        root.addView(input)
    }

    private fun renderPairing() {
        root.addView(Character(this, Character.Tone.BLUE, Character.Mood.WAVE), LinearLayout.LayoutParams(dp(84), dp(88)).apply { topMargin = dp(12); bottomMargin = dp(4) })
        root.addView(HostUi.headline(this, "Pair this phone."))
        root.addView(HostUi.text(this, "In your workspace, choose Add a computer, then scan its QR code or copy its code and paste it here.", 15f, false, true).apply { setPadding(0, dp(4), 0, dp(14)) })
        root.addView(HostUi.button(this, "Scan the QR code", true).apply { tag = "pair-scan"; setOnClickListener { scanPairingQr() } },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(HostUi.button(this, "Paste code from clipboard").apply { tag = "pair-paste"; setOnClickListener { pasteFromClipboard() } },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
        val name = fieldBox(R.id.pair_name, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS, 80).apply { setText(Build.MODEL) }
        val code = fieldBox(R.id.pair_code, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 32).apply {
            hint = "One-use code"
            imeOptions = EditorInfo.IME_ACTION_DONE
        }
        field("Device name", name)
        field("Pairing code", code)
        val server = fieldBox(R.id.pair_server, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI, 512).apply { setText("https://remote.builtbysai.com") }
        val serverLabel = HostUi.text(this, "Server address", 15f, true).apply { labelFor = server.id; visibility = View.GONE; setPadding(0, dp(16), 0, dp(8)) }
        server.visibility = View.GONE
        root.addView(HostUi.link(this, "Server address").apply {
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setOnClickListener {
                val visible = server.visibility != View.VISIBLE
                server.visibility = if (visible) View.VISIBLE else View.GONE
                serverLabel.visibility = server.visibility
            }
        })
        root.addView(serverLabel)
        root.addView(server)
        // One choice up front, so setup is the same few taps whether or not this phone should be reachable unattended.
        val (autoRow, autoSwitch) = HostUi.switchRow(
            this, "Connect without asking",
            UNATTENDED_SUMMARY + " It turns on once setup is done. You can change it later.",
            "pair-unattended", true,
        )
        root.addView(autoRow.apply { setPadding(0, dp(14), 0, 0) })
        val message = HostUi.text(this, pairingNotice.orEmpty(), 15f).apply { tag = "pair-notice"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE; setPadding(0, dp(12), 0, 0) }
        val pair = HostUi.button(this, "Pair device", true).apply { tag = "pair-submit" }
        pair.setOnClickListener {
            val origin = Api.validServer(server.text.toString())
            val deviceName = name.text.toString().trim()
            // Enrollment codes are case-sensitive base64url bearer tokens.
            val pairingCode = code.text.toString().trim()
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
                        identity.unattendedAfterSetup = autoSwitch.isChecked
                    } finally { seed.fill(0) }
                }
                pairingNotice = result.exceptionOrNull()?.let { (it as? PairingFailed)?.message ?: "Could not reach the server. Try again." }
                pairing.set(false)
                handler.post {
                    if (!isDestroyed && !isFinishing) {
                        if (result.isSuccess) {
                            if (notificationsReady()) AvailabilityService.start(this)
                            // Setup starts by itself: the first system prompt appears without another tap.
                            guidedFrom = ""
                            render()
                            handler.postDelayed({ continueGuidedSetup() }, 400)
                        } else {
                            listOf(server, name, code, pair).forEach { it.isEnabled = true }
                            message.text = pairingNotice
                        }
                    }
                }
            }
        }
        code.setOnEditorActionListener { _, action, _ -> if (action == EditorInfo.IME_ACTION_DONE) { pair.performClick(); true } else false }
        root.addView(pair, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(22) })
        root.addView(message)
        root.addView(HostUi.link(this, "Show a code on this phone instead").apply {
            tag = "pair-show-code"
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setPadding(0, dp(18), 0, 0)
            setOnClickListener {
                val origin = Api.validServer(server.text.toString())
                if (origin == null) { server.visibility = View.VISIBLE; serverLabel.visibility = View.VISIBLE; server.error = "Enter a server origin, such as https://remote.builtbysai.com"; server.requestFocus(); return@setOnClickListener }
                identity.unattendedAfterSetup = autoSwitch.isChecked
                startDeviceCode(origin, name.text.toString().trim().ifEmpty { Build.MODEL })
            }
        })
        listOf(server, name, code, pair).forEach { it.isEnabled = !pairing.get() }
    }

    // ---- Device tab --------------------------------------------------------------------------------------------

    private fun friendlyStatus(): String = if (HostState.status == "Available") "Available to connect" else HostState.status

    private fun toggleAvailability() {
        if (identity.wantsAvailable) {
            if (AccessIntents.fence.pending(identity.accessBinding())) runCatching { identity.unattended = false }
            identity.wantsAvailable = false
            stopCapture()
            startService(Intent(this, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP))
        } else if (!notificationsReady()) {
            permissionStartsAvailability = true
            notificationSettings()
        } else AvailabilityService.start(this)
        refreshStatus()
        render()
    }

    private fun renderDevice() {
        // This phone's character (the same colour as its tile in the workspace), its name and state, kept compact so the
        // sharing tile below stays in view even for a long name or a large font (review R16).
        val sharing = HostState.sharing
        val head = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, dp(4))
        }
        head.addView(Character(this, Character.toneFor(identity.machineId), deviceMood()).apply { tag = "device-character" },
            LinearLayout.LayoutParams(dp(60), dp(62)).apply { marginEnd = dp(14) })
        val names = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        names.addView(HostUi.headline(this, identity.name, 26f).apply {
            tag = "device-name"
            maxLines = 2
            ellipsize = android.text.TextUtils.TruncateAt.END
            // The full name is always read out, even when the drawn one is shortened.
            contentDescription = identity.name
            setPadding(0, 0, 0, dp(2))
        })
        names.addView(TextView(this).apply {
            tag = "status"
            text = friendlyStatus()
            textSize = 15f
            typeface = HostUi.bold(context)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            setTextColor(color(if (HostState.status == "Available" || sharing) R.color.beacon_green else R.color.beacon_muted))
        })
        head.addView(names, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        root.addView(head)
        root.addView(HostUi.link(this, if (identity.wantsAvailable) "Go offline" else "Go online").apply {
            tag = "availability-toggle"
            gravity = Gravity.START or Gravity.CENTER_VERTICAL
            setOnClickListener { toggleAvailability() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(6) })
        root.addView(sessionCard(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        setupCard()?.let { root.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }) }
        smoothVideoCard()?.let { root.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) }) }
        val steps = setupSteps()
        val left = steps.count { !it.done }
        root.addView(overviewRow("Connect without asking", accessSummary()) { selectPage("access") }.also { (it.layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(16) })
        root.addView(overviewRow("Clipboard", clipboardName(identity.clipboardMode)) { selectPage("privacy") })
        root.addView(overviewRow("Phone setup", if (left == 0) "Ready: all ${steps.size} steps done" else "${steps.size - left} of ${steps.size} done · ${stepsLeft(left)}") { selectPage("access") })
    }

    private fun stepsLeft(count: Int) = if (count == 1) "1 step left" else "$count steps left"

    /** The face says the state: asleep offline, awake and signalling when reachable, waving while someone is connected. */
    private fun deviceMood(): Character.Mood = when {
        HostState.sharing && HostState.paused -> Character.Mood.ASLEEP
        HostState.sharing -> Character.Mood.WAVE
        !identity.wantsAvailable -> Character.Mood.ASLEEP
        HostState.status != "Available" -> Character.Mood.WOW
        else -> Character.Mood.AWAKE
    }

    /** What "Connect without asking" means for this phone right now, in a few words. */
    private fun accessSummary(): String = when {
        identity.paired && AccessIntents.fence.pending(identity.accessBinding()) -> "Updating…"
        identity.unattended -> "On"
        identity.unattendedAfterSetup -> "Turns on when setup is done"
        else -> "Off · you approve each request"
    }

    private fun sessionCard(): LinearLayout {
        val sharing = HostState.sharing
        val paused = sharing && HostState.paused
        val offline = !sharing && !identity.wantsAvailable
        val unattended = identity.unattended
        // Colour is content: brand blue while someone sees the screen (Stop is the action), sun while paused, mint when
        // private and reachable, plain tile when offline. The words always say the state too.
        val fill = when {
            paused -> R.color.beacon_tint_sun
            sharing -> R.color.beacon_accent
            offline -> R.color.beacon_tile
            else -> R.color.beacon_tint_mint
        }
        val onBlue = sharing && !paused
        val ink = if (onBlue) color(R.color.beacon_on_accent) else color(R.color.beacon_text)
        val soft = if (onBlue) ink else color(R.color.beacon_muted)
        val title = when {
            paused -> "Sharing paused."
            sharing -> "Sharing your screen."
            offline -> "Offline."
            else -> "Not sharing."
        }
        val sub = when {
            paused -> "The viewer is still connected but sees no screen updates."
            sharing -> if (HostState.controlling) "The viewer can see your screen and touch and type." else "The viewer can see your screen."
            offline -> "This phone is not accepting remote connections."
            unattended -> "Your screen is private. Your account can connect without asking; anyone else needs your approval."
            else -> "Your screen is private. Each request needs your approval here."
        }
        val foot = when {
            paused -> "Resume or Stop at any time"
            sharing -> "Pause and Stop stay here and in the notification"
            offline -> "Go online to be reachable again"
            else -> "Pause and Stop appear here while sharing"
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            tag = "session-card"
            setPadding(dp(22), dp(20), dp(22), dp(20))
            background = HostUi.tile(this@MainActivity, color(fill))
        }
        card.addView(TextView(this).apply { text = "Screen sharing"; textSize = 14f; typeface = HostUi.bold(context); setTextColor(soft); alpha = if (onBlue) 0.85f else 1f })
        card.addView(TextView(this).apply {
            text = title
            tag = "session-title"
            textSize = 32f
            typeface = HostUi.heavy(context)
            letterSpacing = -0.035f
            setLineSpacing(0f, 1.02f)
            setTextColor(ink)
            setPadding(0, dp(6), 0, 0)
            ViewCompat.setAccessibilityHeading(this, true)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        })
        card.addView(TextView(this).apply { text = sub; tag = "session-detail"; textSize = 15f; typeface = HostUi.font(context, 400); setTextColor(soft); alpha = if (onBlue) 0.9f else 1f; setLineSpacing(0f, 1.18f); setPadding(0, dp(8), 0, 0) })
        card.addView(TextView(this).apply { text = foot; textSize = 13f; typeface = HostUi.bold(context); setTextColor(soft); alpha = if (onBlue) 0.8f else 1f; setPadding(0, dp(12), 0, 0) })
        if (sharing) {
            // Stop is always the most prominent control while someone can see the screen.
            val actions = LinearLayout(this).apply { setPadding(0, dp(14), 0, 0) }
            actions.addView(sessionButton(if (paused) "Resume" else "Pause", onBlue, prominent = false) {
                pauseOrResume()
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(5) })
            actions.addView(sessionButton(if (paused) "Stop" else "Stop sharing", onBlue, prominent = true) {
                stopCapture()
            }.apply { tag = "session-stop" }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(5) })
            card.addView(actions)
        }
        return card
    }

    /** Pill buttons on the sharing tile: on brand blue a white Stop and an outlined Pause; on a tint an ink Stop. */
    private fun sessionButton(label: String, onBlue: Boolean, prominent: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 15f
        typeface = HostUi.bold(context)
        stateListAnimator = null
        minHeight = dp(48)
        minimumHeight = dp(48)
        setPadding(dp(14), dp(6), dp(14), dp(6))
        when {
            onBlue && prominent -> { background = HostUi.pill(this@MainActivity, Color.WHITE); setTextColor(0xFF17171A.toInt()) }
            onBlue -> { background = HostUi.pill(this@MainActivity, Color.TRANSPARENT, 0xB3FFFFFF.toInt()); setTextColor(Color.WHITE) }
            prominent -> { background = HostUi.pill(this@MainActivity, color(R.color.beacon_ink)); setTextColor(color(R.color.beacon_on_ink)) }
            else -> { background = HostUi.pill(this@MainActivity, color(R.color.beacon_surface)); setTextColor(color(R.color.beacon_text)) }
        }
        HostUi.pressable(this)
        setOnClickListener { onClick() }
    }

    /**
     * Connect without asking includes smooth video, which Android lets Beacon start only after its own one-tap prompt,
     * once after every restart of the app or the phone. Until then this says so and offers the prompt (review R15).
     */
    private fun smoothVideoCard(): LinearLayout? {
        if (!identity.unattended || StandingScreen.active || Build.VERSION.SDK_INT < 30 || setupSteps().any { !it.done }) return null
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            tag = "smooth-video-card"
            setPadding(dp(20), dp(18), dp(20), dp(18))
            background = HostUi.tile(this@MainActivity, color(R.color.beacon_tint_blue), 24)
        }
        card.addView(HostUi.text(this, "Smooth video is off", 18f, true).apply { setPadding(0, 0, 0, dp(4)) })
        card.addView(HostUi.text(this, "Android asks once after each restart before Beacon can send smooth video without asking. Until then your account can still connect, with slower video and without the phone's sound.", 14f, false, true))
        card.addView(HostUi.button(this, "Turn on smooth video", true).apply {
            tag = "smooth-video-start"
            setOnClickListener { fastAsked = false; resumeFastVideo() }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return card
    }

    private fun pauseOrResume() {
        startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_PAUSE))
        handler.postDelayed({ if (!isDestroyed) refreshStatus() }, 400)
    }

    /** A row that opens another tab: its title, then where it stands now. The whole row is one 48 dp+ button. */
    private fun overviewRow(title: String, summary: String, onClick: () -> Unit): LinearLayout {
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        wrap.addView(HostUi.divider(this))
        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(60)
            setPadding(dp(1), dp(10), dp(1), dp(10))
            isClickable = true
            isFocusable = true
            contentDescription = "$title: $summary"
            HostUi.role(this, Button::class.java.name)
            setOnClickListener { onClick() }
        }
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(this).apply { text = title; textSize = 16f; typeface = HostUi.bold(context); setTextColor(color(R.color.beacon_text)) })
        texts.addView(TextView(this).apply { text = summary; textSize = 14f; typeface = HostUi.font(context, 400); setTextColor(color(R.color.beacon_muted)); setPadding(0, dp(2), 0, 0) })
        row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(TextView(this).apply {
            text = "›"
            textSize = 22f
            typeface = HostUi.bold(context)
            setTextColor(color(R.color.beacon_muted))
            setPadding(dp(10), 0, dp(4), 0)
        })
        wrap.addView(row)
        wrap.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        return wrap
    }

    // ---- Access tab --------------------------------------------------------------------------------------------

    private fun subhead(title: String, copy: String) {
        root.addView(HostUi.headline(this, title).apply { setPadding(0, dp(14), 0, dp(4)) })
        root.addView(HostUi.text(this, copy, 15f, false, true).apply { setPadding(0, dp(2), dp(24), dp(14)) })
    }

    private fun renderAccess() {
        subhead("Access.", "Who can reach this phone from your workspace, and what it still needs.")
        root.addView(HostUi.divider(this))
        val (accessRow, accessSwitch) = HostUi.switchRow(
            this, "Connect without asking",
            "$UNATTENDED_SUMMARY Smooth video is included. Turn it off to approve each request on this phone instead.",
            "access-toggle", identity.unattended,
        )
        accessSwitch.setOnClickListener {
            // The real state is set once the change has been applied; until then the switch shows what is true now.
            accessSwitch.isChecked = identity.unattended
            changeAccess()
        }
        accessRow.addView(HostUi.text(this, "Needs Android 11 or later. While smooth video is on, Android shows its screen-sharing icon. After a restart, open Beacon once and accept Android's prompt to turn smooth video back on; until then video is slower and without the phone's sound. Beacon never stores your passcode.", 13f, false, true).apply { setPadding(0, dp(10), dp(24), 0) })
        accessRow.addView(HostUi.text(this, "", 14f).apply {
            tag = "access-notice"
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            val note = AccessIntents.notice?.takeIf { it.first == identity.accessBinding() }?.second.orEmpty()
            text = note
            visibility = if (note.isEmpty()) View.GONE else View.VISIBLE
            setPadding(0, dp(10), 0, 0)
        })
        root.addView(accessRow)
        root.addView(HostUi.divider(this))
        root.addView(lockTypeLine())
        root.addView(HostUi.divider(this))
        val steps = setupSteps()
        val left = steps.count { !it.done }
        val title = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(18), 0, dp(4)) }
        title.addView(TextView(this).apply { text = "Phone setup"; textSize = 18f; typeface = HostUi.bold(context); setTextColor(color(R.color.beacon_text)); ViewCompat.setAccessibilityHeading(this, true) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        title.addView(TextView(this).apply {
            text = if (left == 0) "All ${steps.size} done" else "${steps.size - left} of ${steps.size} done"
            textSize = 14f
            typeface = HostUi.bold(context)
            setTextColor(color(if (left == 0) R.color.beacon_green else R.color.beacon_muted))
            tag = "setup-count"
        })
        root.addView(title)
        root.addView(HostUi.text(this, readiness(steps), 14f, false, true).apply { tag = "setup-readiness"; setPadding(0, 0, dp(12), dp(8)) })
        for (step in steps) root.addView(checkRow(step))
    }

    /**
     * What works now and what each missing step would add, so a partly set-up phone is described precisely rather than
     * as "needs attention" (review R15).
     */
    private fun readiness(steps: List<SetupStep>): String {
        val missing = steps.filter { !it.done }.map { it.title }
        if (missing.isEmpty()) return if (identity.unattended) "Ready. Your account can connect without asking, and you can approve requests from anyone else."
        else "Ready. People you allow can ask to see this screen, and you approve each request here."
        if ("Notifications allowed" in missing) return "Nothing can connect yet: Android needs notifications on so Pause and Stop are always visible while sharing."
        val parts = ArrayList<String>()
        parts += "Requests you approve work now."
        if ("Beacon accessibility enabled" in missing) parts += "A viewer can watch but not touch or type until accessibility is on" +
            (if (identity.unattended || identity.unattendedAfterSetup) ", and Connect without asking needs it too." else ".")
        if ("Background running allowed" in missing) parts += "Without background running, Android may stop Beacon while the screen is off."
        if (identity.unattendedAfterSetup && !identity.unattended) parts += "Connect without asking turns on when these are done."
        return parts.joinToString(" ")
    }

    /** What kind of lock the phone has, as far as Beacon has seen: shown under the unlock switch. */
    private fun lockTypeLine(): TextView {
        val kind = identity.lastLockKind
        val secure = getSystemService(android.app.KeyguardManager::class.java).isDeviceSecure
        val text = when {
            !secure -> "This phone has no screen lock, so there is nothing to unlock."
            kind.isEmpty() -> "Lock type: not seen yet. Beacon learns it the first time a viewer opens the unlock pad on the lock screen."
            else -> "Lock type: " + when (kind) { "pin" -> "PIN"; "pattern" -> "Pattern"; else -> "Password" } +
                " (last seen " + android.text.format.DateUtils.getRelativeTimeSpanString(identity.lastLockKindAt, System.currentTimeMillis(), android.text.format.DateUtils.MINUTE_IN_MILLIS) + ")"
        }
        return HostUi.text(this, text, 14f, false, true).apply { tag = "lock-type"; setPadding(0, dp(14), dp(24), dp(14)) }
    }

    /** One setup step: a check badge when done; otherwise the whole row is a 48 dp+ button that does the step. */
    private fun checkRow(step: SetupStep): LinearLayout = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(52)
        setPadding(0, dp(4), 0, dp(4))
        tag = "setup-${step.title}"
        addView(TextView(context).apply {
            text = if (step.done) "✓" else ""
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 13f)
            includeFontPadding = false
            typeface = HostUi.bold(context)
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            background = if (step.done) HostUi.pill(this@MainActivity, color(R.color.beacon_green))
            else HostUi.pill(this@MainActivity, Color.TRANSPARENT, color(R.color.beacon_line_strong))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        }, LinearLayout.LayoutParams(dp(24), dp(24)).apply { marginEnd = dp(12) })
        addView(TextView(context).apply {
            text = step.title
            textSize = 15f
            typeface = if (step.done) HostUi.font(context, 400) else HostUi.bold(context)
            setTextColor(color(R.color.beacon_text))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (!step.done) {
            addView(TextView(context).apply {
                text = "Set up"
                textSize = 14f
                typeface = HostUi.bold(context)
                gravity = Gravity.CENTER
                minHeight = dp(40)
                setPadding(dp(16), dp(6), dp(16), dp(6))
                setTextColor(color(R.color.beacon_on_ink))
                background = HostUi.pill(this@MainActivity, color(R.color.beacon_ink))
                importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
            })
            isClickable = true
            isFocusable = true
            contentDescription = "Set up: ${step.button}"
            HostUi.role(this, Button::class.java.name)
            setOnClickListener { step.action() }
        } else {
            contentDescription = "${step.title}: done"
        }
    }

    // ---- Privacy tab -------------------------------------------------------------------------------------------

    private fun clipboardName(mode: String) = when (mode) { "off" -> "Off"; "auto" -> "Automatic"; else -> "Button only" }

    private fun clipboardWords(mode: String) = when (mode) {
        "off" -> "Nothing on the clipboard is shared with a viewer."
        "auto" -> "Copied content moves both ways while a viewer is connected."
        else -> "Copied content moves only when the viewer presses a button."
    }

    private fun renderPrivacy() {
        subhead("Privacy.", "What a connected viewer can receive from this phone.")
        root.addView(HostUi.divider(this))
        root.addView(HostUi.text(this, "Clipboard", 18f, true).apply { setPadding(0, dp(16), 0, dp(10)); ViewCompat.setAccessibilityHeading(this, true) })
        // Each option grows with its text and is at least 48 dp tall, so a 200% font never clips it (review R33).
        val segmented = HostUi.segmented(this, listOf("auto" to "Automatic", "button" to "Button only", "off" to "Off"), identity.clipboardMode, "clipboard") { mode ->
            identity.clipboardMode = mode
            render()
        }.apply { tag = "clipboard-mode" }
        root.addView(segmented, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(HostUi.text(this, clipboardWords(identity.clipboardMode), 14f, false, true).apply { setPadding(0, dp(10), 0, dp(16)) })
        root.addView(HostUi.divider(this))
        // Three different sounds, told apart (review R14): what the phone plays, its microphone, and a viewer's voice.
        root.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            tag = "phone-sound"
            setPadding(0, dp(14), 0, dp(16))
            addView(HostUi.text(this@MainActivity, "Phone sound", 18f, true).apply { setPadding(0, 0, 0, dp(4)) })
            addView(HostUi.text(this@MainActivity, phoneSoundWords(), 14f, false, true).apply { setPadding(0, 0, dp(24), 0) })
        })
        root.addView(HostUi.divider(this))
        val granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val (micRow, micSwitch) = HostUi.switchRow(
            this, "Microphone",
            "Trusted viewers can also hear what's around the phone through its microphone, even while it's locked. Android shows when it's in use.",
            "mic-toggle", identity.shareMic && granted,
        )
        micSwitch.setOnClickListener {
            micSwitch.isChecked = identity.shareMic && granted
            when {
                identity.shareMic -> { identity.shareMic = false; render() }
                granted -> { identity.shareMic = true; render() }
                else -> requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 3)
            }
        }
        root.addView(micRow)
        root.addView(HostUi.divider(this))
        val (talkRow, talkSwitch) = HostUi.switchRow(
            this, "Talk through this phone",
            "Trusted viewers can talk through your phone's speaker, only while it's unlocked. The sharing notification says when someone is talking.",
            "talk-toggle", identity.talkIn,
        )
        talkSwitch.setOnClickListener {
            identity.talkIn = !identity.talkIn
            render()
        }
        root.addView(talkRow)
        root.addView(HostUi.divider(this))
        root.addView(HostUi.text(this, "Receiving files is approved for each attended request. Files are saved to Downloads/Beacon Remote.", 14f, false, true).apply { setPadding(0, dp(14), dp(24), 0) })
    }

    /** What the phone plays (not the microphone): sent with the screen where Android allows it. */
    private fun phoneSoundWords(): String = when {
        Build.VERSION.SDK_INT < 29 -> "Not available: sending what the phone plays needs Android 10 or later."
        checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED ->
            "What the phone plays is sent with the screen once Beacon has Android's audio permission. Some apps block it."
        else -> "What the phone plays is sent with the screen. Some apps block it. This is not the microphone." +
            if (identity.unattended && !StandingScreen.active) " Without asking, it is sent only while smooth video is on." else ""
    }

    // ---- Sheets ------------------------------------------------------------------------------------------------

    private fun showMenu() {
        if (!identity.paired) return
        HostUi.sheet(this) { panel, close ->
            panel.addView(HostUi.headline(this, "More options", 28f))
            fun choice(label: String, danger: Boolean, action: () -> Unit) {
                panel.addView(HostUi.divider(this))
                panel.addView(TextView(this).apply {
                    text = label
                    textSize = 16f
                    typeface = HostUi.bold(context)
                    gravity = Gravity.CENTER_VERTICAL
                    minHeight = dp(56)
                    setTextColor(color(if (danger) R.color.beacon_danger else R.color.beacon_text))
                    setPadding(0, dp(12), 0, dp(12))
                    isClickable = true
                    isFocusable = true
                    HostUi.role(this, Button::class.java.name)
                    setOnClickListener { close(); action() }
                })
            }
            choice("Connection details", false) { showDetails() }
            choice("Remove device", true) { confirmRemove() }
        }.show()
    }

    private fun showDetails() {
        HostUi.sheet(this) { panel, close ->
            panel.addView(HostUi.headline(this, "Connection details", 28f))
            panel.addView(HostUi.text(this, "This phone talks to your Beacon Remote workspace at this address.", 15f, false, true).apply { setPadding(0, dp(8), 0, dp(18)) })
            panel.addView(HostUi.text(this, "Server", 14f, true, true).apply { setPadding(0, 0, 0, dp(6)) })
            panel.addView(HostUi.divider(this))
            val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(6), 0, dp(6)) }
            row.addView(TextView(this).apply { text = identity.server; textSize = 15f; typeface = HostUi.mono(context); setTextColor(color(R.color.beacon_text)) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            row.addView(HostUi.link(this, "Copy").apply {
                setOnClickListener {
                    getSystemService(ClipboardManager::class.java).setPrimaryClip(ClipData.newPlainText("Beacon server", identity.server))
                    Toast.makeText(this@MainActivity, "Copied to clipboard", Toast.LENGTH_SHORT).show()
                }
            })
            panel.addView(row)
            panel.addView(HostUi.divider(this))
            panel.addView(TextView(this).apply {
                text = "Remove device"
                textSize = 15f
                typeface = HostUi.bold(context)
                gravity = Gravity.CENTER_VERTICAL
                minHeight = dp(48)
                setTextColor(color(R.color.beacon_danger))
                setPadding(0, dp(10), 0, 0)
                isClickable = true
                isFocusable = true
                HostUi.role(this, Button::class.java.name)
                setOnClickListener { close(); confirmRemove() }
            })
        }.show()
    }

    private fun confirmRemove() {
        HostUi.sheet(this) { panel, close ->
            panel.addView(Character(this, Character.toneFor(identity.machineId), Character.Mood.LOCKED), LinearLayout.LayoutParams(dp(64), dp(66)).apply { bottomMargin = dp(6) })
            panel.addView(HostUi.headline(this, "Remove this phone?", 28f))
            panel.addView(HostUi.text(this, "This stops sharing and removes the pairing on this phone. Remove it from your workspace too, so it no longer appears there.", 15f, false, true).apply { setPadding(0, dp(8), 0, dp(18)) })
            val buttons = LinearLayout(this)
            buttons.addView(HostUi.button(this, "Cancel").apply { setOnClickListener { close() } }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(4) })
            buttons.addView(HostUi.button(this, "Remove device", true).apply {
                tag = "confirm-remove"
                background = HostUi.pill(this@MainActivity, color(R.color.beacon_danger))
                setTextColor(color(R.color.beacon_on_ink))
                setOnClickListener { close(); unpair() }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(4) })
            panel.addView(buttons)
        }.show()
    }

    // ---- Behaviour (unchanged rules) --------------------------------------------------------------------------

    private fun notificationsReady() = NotificationManagerCompat.from(this).areNotificationsEnabled()

    private fun notificationSettings() {
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        } else startActivity(SharingNotifications.settings(this))
    }

    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_FAST && resultCode == RESULT_OK && data != null) {
            startForegroundService(
                Intent(this, StandingCaptureService::class.java)
                    .putExtra(StandingCaptureService.EXTRA_CODE, resultCode)
                    .putExtra(StandingCaptureService.EXTRA_DATA, data),
            )
            handler.postDelayed({ if (!isDestroyed && !isFinishing) render() }, 800)
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == 3) {
            identity.shareMic = results.firstOrNull() == PackageManager.PERMISSION_GRANTED
            render()
            return
        }
        if (requestCode == 2) {
            handler.post { if (!isDestroyed && !isFinishing) resumeFastVideo() }
            render()
            return
        }
        if (requestCode == 1 && permissionStartsAvailability) {
            permissionStartsAvailability = false
            if (notificationsReady() && identity.paired) AvailabilityService.start(this)
        }
    }

    private fun stopCapture() { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP)) }

    private class SetupStep(val title: String, val button: String, val done: Boolean, val why: String, val hint: String? = null, val action: () -> Unit)

    /** The few things this phone needs, in the order that works. Each one is a single action. */
    private fun setupSteps(): List<SetupStep> {
        val list = ArrayList<SetupStep>()
        list += SetupStep(
            "Notifications allowed", "Allow notifications", SharingNotifications.ready(this),
            "So Pause and Stop stay visible whenever your screen is shared.",
        ) { notificationSettings() }
        if (Build.VERSION.SDK_INT >= 30) {
            list += SetupStep(
                "Beacon accessibility enabled", "Turn on accessibility", ControlService.enabled(this) && ControlService.instance != null,
                "Lets a viewer touch and type. It acts only while someone is connected: a request you approved, or your own account with Connect without asking on.",
                hint = "If Android says the setting is restricted: open App info, tap ⋮ (top right), choose Allow restricted settings, then come back.",
            ) { openAccessibilityPage() }
        }
        val power = getSystemService(android.os.PowerManager::class.java)
        list += SetupStep(
            "Background running allowed", "Allow background running", power.isIgnoringBatteryOptimizations(packageName),
            "Keeps this phone reachable when the screen is off.",
        ) { requestBatteryExemption() }
        return list
    }

    /** The pairing screen's "Connect without asking" choice is applied once the permissions above are in place. */
    private fun finishAccessIfWanted() {
        if (!identity.paired || !identity.unattendedAfterSetup || identity.unattended) return
        if (setupSteps().any { !it.done }) return
        identity.unattendedAfterSetup = false
        changeAccess()
    }

    /** Opens Beacon's own accessibility page, not the long list of apps; falls back to the list. */
    private fun openAccessibilityPage() {
        val component = ComponentName(this, ControlService::class.java).flattenToString()
        val direct = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS").putExtra("android.provider.extra.COMPONENT_NAME", component)
        if (runCatching { startActivity(direct) }.isFailure) startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))
    }

    /** Android's one-tap "let this app run in the background" dialog; the settings list is the fallback. */
    private fun requestBatteryExemption() {
        val ask = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, android.net.Uri.parse("package:$packageName"))
        if (runCatching { startActivity(ask) }.isFailure) startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
    }

    private fun openAppInfo() {
        startActivity(Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName")))
    }

    /**
     * The tile on the Device tab until setup is done: how far along, the one next step and why, and one button that does
     * it. Below the sharing tile, so the phone's private/shared state is always the first thing on screen (review R15).
     */
    private fun setupCard(): LinearLayout? {
        val steps = setupSteps()
        val next = steps.firstOrNull { !it.done } ?: return null
        val done = steps.count { it.done }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            tag = "setup-card"
            setPadding(dp(20), dp(18), dp(20), dp(20))
            background = HostUi.tile(this@MainActivity, color(R.color.beacon_tint_sun), 24)
        }
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(TextView(this).apply { text = "Finish setup"; textSize = 15f; typeface = HostUi.bold(context); setTextColor(color(R.color.beacon_text)) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(TextView(this).apply { text = "Step ${done + 1} of ${steps.size}"; tag = "setup-step"; textSize = 14f; typeface = HostUi.bold(context); setTextColor(color(R.color.beacon_muted)) })
        card.addView(top)
        val bars = LinearLayout(this).apply {
            setPadding(0, dp(10), 0, dp(12))
            contentDescription = "$done of ${steps.size} setup steps done"
        }
        for ((index, step) in steps.withIndex()) {
            bars.addView(View(this).apply {
                background = HostUi.pill(this@MainActivity, color(if (step.done) R.color.beacon_ink else R.color.beacon_line_strong))
            }, LinearLayout.LayoutParams(0, dp(5), 1f).apply { if (index > 0) marginStart = dp(5) })
        }
        card.addView(bars)
        card.addView(TextView(this).apply { text = next.title.replace(" allowed", "").replace(" enabled", ""); textSize = 20f; typeface = HostUi.heavy(context); letterSpacing = -0.02f; setTextColor(color(R.color.beacon_text)) })
        card.addView(HostUi.text(this, next.why, 14f, false, true).apply { setPadding(0, dp(4), 0, dp(12)) })
        next.hint?.let { hint ->
            card.addView(HostUi.text(this, hint, 13f, false, true).apply { setPadding(0, 0, 0, 0) })
            card.addView(HostUi.link(this, "Open app info").apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL; setOnClickListener { openAppInfo() } })
        }
        card.addView(HostUi.button(this, next.button, true).apply {
            tag = "setup-next"
            setOnClickListener {
                guidedFrom = next.title
                next.action()
            }
        }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        return card
    }

    private fun changeAccess() {
        val binding = identity.accessBinding()
        val enable = !identity.unattended && !AccessIntents.fence.pending(binding)
        if (enable && !SharingNotifications.ready(this)) { notificationSettings(); return }
        if (enable && !UnattendedAccess.ready(this)) { startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS)); return }
        if (!enable) {
            stopCapture()
            startService(Intent(this, StandingCaptureService::class.java).setAction(StandingCaptureService.ACTION_STOP))
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
                    if (result.getOrDefault(false) && identity.unattended) { fastAsked = false; resumeFastVideo() }
                    refreshStatus()
                }
            }
        }
        refreshStatus()
    }

    /** Everything on a paired screen that can change by itself. When it changes the screen is drawn again. */
    private fun currentSignature(): String = listOf(
        identity.paired, page, HostState.status, HostState.sharing, HostState.paused, HostState.controlling, identity.wantsAvailable,
        identity.lastLockKind, identity.unattended, identity.unlockFromViewer, identity.clipboardMode, identity.shareSound, identity.shareMic, identity.talkIn, StandingScreen.active,
        checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED,
        if (identity.paired) identity.name else "", notificationsReady(),
        ControlService.enabled(this) && ControlService.instance != null,
        getSystemService(android.os.PowerManager::class.java).isIgnoringBatteryOptimizations(packageName),
        if (identity.paired) AccessIntents.fence.pending(identity.accessBinding()) else false,
        if (identity.paired) AccessIntents.notice?.takeIf { it.first == identity.accessBinding() }?.second else null,
    ).joinToString("|")

    private fun refreshStatus() {
        if (!::root.isInitialized) return
        if (!identity.paired) {
            root.findViewWithTag<Button>("pair-submit")?.apply { text = if (pairing.get()) "Pairing…" else "Pair device"; isEnabled = !pairing.get() }
            root.findViewWithTag<TextView>("pair-notice")?.text = if (pairing.get()) "Pairing…" else pairingNotice.orEmpty()
            if (!pairing.get()) listOf(R.id.pair_name, R.id.pair_code, R.id.pair_server).forEach { root.findViewById<EditText>(it)?.isEnabled = true }
            return
        }
        if (currentSignature() != signature) render()
    }

    private fun unpair() {
        stopCapture()
        startService(Intent(this, AvailabilityService::class.java).setAction(AvailabilityService.ACTION_STOP))
        identity.clear()
        AccessIntents.notice = null
        page = "device"
        render()
    }

    private companion object {
        val pairing = AtomicBoolean(false)
        private const val REQUEST_FAST = 21
        /** The one combined unattended setting, said the same way on pairing and on Access (review R14). */
        const val UNATTENDED_SUMMARY = "Your account can see and control this phone without a prompt each time, including unlocking it from the viewer. Pause and Stop stay on screen."
        @Volatile var pairingNotice: String? = null
        @Volatile var page = "device"
    }
}

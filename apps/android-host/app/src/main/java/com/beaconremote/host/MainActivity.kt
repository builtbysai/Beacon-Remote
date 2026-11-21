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
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.InputFilter
import android.text.InputType
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
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
            setOnClickListener { showMenu() }
        }
        val header = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            val horizontal = maxOf(25, (resources.configuration.screenWidthDp - 600) / 2)
            setPadding(dp(horizontal), dp(8), dp(horizontal - 8), dp(4))
            addView(brand(), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
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

    override fun onResume() {
        super.onResume()
        handler.removeCallbacks(refreshTask)
        refreshTask.run()
        continueGuidedSetup()
    }

    /** Back from an Android settings screen: if that step got done, go straight to the next one. */
    private fun continueGuidedSetup() {
        val from = guidedFrom ?: return
        if (!identity.paired) { guidedFrom = null; return }
        val next = setupSteps().firstOrNull { !it.done }
        if (next == null || next.title == from) { guidedFrom = null; return }
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

    private fun brand(): TextView = TextView(this).apply {
        val name = SpannableStringBuilder("Beacon Remote")
        name.setSpan(ForegroundColorSpan(color(R.color.beacon_muted)), 7, name.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        text = name
        textSize = 20f
        typeface = Typeface.DEFAULT_BOLD
        letterSpacing = -0.03f
        setTextColor(color(R.color.beacon_text))
    }

    private fun buildNav(): LinearLayout {
        val bar = LinearLayout(this).apply { setPadding(dp(15), dp(4), dp(15), dp(6)) }
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
                setPadding(0, dp(8), 0, dp(8))
                addView(ImageView(context).apply { setImageResource(icon); tag = "icon" }, LinearLayout.LayoutParams(dp(22), dp(22)))
                addView(TextView(context).apply {
                    text = label
                    textSize = 11f
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setPadding(0, dp(4), 0, 0)
                    tag = "label"
                })
                setOnClickListener { selectPage(id) }
            }
            navItems[id] = item
            bar.addView(item, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(2); marginEnd = dp(2) })
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
        page = id
        render()
    }

    private fun updateNav() {
        for ((id, item) in navItems) {
            val selected = id == page
            val tint = ColorStateList.valueOf(color(if (selected) R.color.beacon_text else R.color.beacon_muted))
            item.background = if (selected) HostUi.rounded(this, color(R.color.beacon_soft), 4) else null
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
        setTextColor(color(R.color.beacon_text))
        setHintTextColor(color(R.color.beacon_muted))
        background = HostUi.rounded(this@MainActivity, color(R.color.beacon_surface), 4, color(R.color.beacon_line))
        setPadding(dp(14), 0, dp(14), 0)
        importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO
    }

    private fun field(title: String, input: EditText) {
        root.addView(HostUi.text(this, title, 12f, true, true).apply {
            labelFor = input.id
            setPadding(0, dp(16), 0, dp(6))
        })
        root.addView(input)
    }

    private fun renderPairing() {
        root.addView(HostUi.kicker(this, "Set up"))
        root.addView(HostUi.headline(this, "Pair this device."))
        root.addView(HostUi.text(this, "In your workspace, choose Add a computer, then copy its code or link and paste it here.", 13f, false, true).apply { setPadding(0, dp(4), 0, dp(8)) })
        root.addView(HostUi.button(this, "Paste code from clipboard").apply { tag = "pair-paste"; setOnClickListener { pasteFromClipboard() } },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        val name = fieldBox(R.id.pair_name, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_WORDS, 80).apply { setText(Build.MODEL) }
        val code = fieldBox(R.id.pair_code, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS, 32).apply {
            hint = "One-use code"
            imeOptions = EditorInfo.IME_ACTION_DONE
        }
        field("Device name", name)
        field("Pairing code", code)
        val server = fieldBox(R.id.pair_server, InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI, 512).apply { setText("https://remote.builtbysai.com") }
        val serverLabel = HostUi.text(this, "Server address", 12f, true, true).apply { labelFor = server.id; visibility = View.GONE; setPadding(0, dp(16), 0, dp(6)) }
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
        val message = HostUi.text(this, pairingNotice.orEmpty(), 14f).apply { tag = "pair-notice"; accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE; setPadding(0, dp(12), 0, 0) }
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
        root.addView(pair, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(22) })
        root.addView(message)
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
        root.addView(HostUi.kicker(this, "This device"))
        root.addView(HostUi.headline(this, identity.name, 42f))
        val meta = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(8), 0, dp(14))
        }
        meta.addView(TextView(this).apply {
            tag = "status"
            text = friendlyStatus()
            textSize = 13f
            typeface = Typeface.DEFAULT_BOLD
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            setTextColor(color(R.color.beacon_text))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        meta.addView(HostUi.link(this, if (identity.wantsAvailable) "Go offline" else "Go online").apply {
            tag = "availability-toggle"
            setOnClickListener { toggleAvailability() }
        })
        root.addView(meta)
        setupCard()?.let { root.addView(it, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(14) }) }
        root.addView(sessionCard(), LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(overviewRow("Unattended access", "Connect without asking", if (identity.unattended) "Enabled" else "Off") { selectPage("access") }.also { (it.layoutParams as? LinearLayout.LayoutParams)?.topMargin = dp(14) })
        root.addView(overviewRow("Clipboard", "How copied content moves between devices", clipboardName(identity.clipboardMode)) { selectPage("privacy") })
        val steps = setupSteps()
        root.addView(overviewRow("Device setup", if (steps.all { it.done }) "All permissions ready" else "One permission needs attention", "") { selectPage("access") })
    }

    private fun sessionCard(): LinearLayout {
        val sharing = HostState.sharing
        val paused = sharing && HostState.paused
        val offline = !sharing && !identity.wantsAvailable
        val fill = when {
            paused -> R.color.beacon_paused
            sharing -> R.color.beacon_accent
            offline -> R.color.beacon_offline
            else -> R.color.beacon_dark
        }
        val tagText = when {
            paused -> "Paused"
            sharing -> "Connected"
            offline -> "Offline"
            else -> ""
        }
        val title = when {
            paused -> "Sharing paused."
            sharing -> "Sharing your screen."
            offline -> "Offline."
            else -> "Not sharing."
        }
        val sub = when {
            paused -> "The viewer is connected but cannot see screen updates."
            sharing -> if (HostState.controlling) "Your screen is visible to the approved viewer, who can also touch and type." else "Your screen is visible to the approved viewer."
            offline -> "This phone is not accepting remote connections."
            else -> "Your screen is private. An incoming request needs your approval."
        }
        val foot = when {
            paused -> "Sharing is temporarily paused"
            sharing -> "Pause and Stop stay available"
            offline -> "Connections are unavailable"
            else -> "Pause and Stop are available during sharing"
        }
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            tag = "session-card"
            minimumHeight = dp(270)
            setPadding(dp(23), dp(23), dp(23), dp(20))
            background = HostUi.rounded(this@MainActivity, color(fill), 4)
        }
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(TextView(this).apply { text = "Screen sharing"; textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setTextColor(Color.WHITE) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (tagText.isNotEmpty()) top.addView(TextView(this).apply { text = tagText; textSize = 12f; setTextColor(Color.WHITE); alpha = 0.7f })
        card.addView(top)
        val body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(8), 0, dp(8)) }
        body.addView(TextView(this).apply {
            text = title
            textSize = 36f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = -0.04f
            setLineSpacing(0f, 0.98f)
            setTextColor(Color.WHITE)
        })
        body.addView(TextView(this).apply { text = sub; textSize = 13f; setTextColor(Color.WHITE); alpha = 0.78f; setLineSpacing(0f, 1.15f); setPadding(0, dp(10), 0, 0) })
        card.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        val line = View(this).apply { setBackgroundColor(Color.WHITE); alpha = 0.22f }
        card.addView(line, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1))
        val footer = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(14), 0, 0) }
        footer.addView(TextView(this).apply { text = foot; textSize = 12f; setTextColor(Color.WHITE); alpha = 0.7f }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (sharing) {
            footer.addView(sessionButton(if (paused) "Stop" else "Pause", secondary = true) {
                if (paused) stopCapture() else pauseOrResume()
            })
            footer.addView(sessionButton(if (paused) "Resume" else "Stop sharing", secondary = false) {
                if (paused) pauseOrResume() else stopCapture()
            }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginStart = dp(8) })
        }
        card.addView(footer)
        return card
    }

    private fun sessionButton(label: String, secondary: Boolean, onClick: () -> Unit) = Button(this).apply {
        text = label
        isAllCaps = false
        textSize = 12f
        typeface = Typeface.DEFAULT_BOLD
        stateListAnimator = null
        minHeight = dp(40)
        minimumHeight = dp(40)
        setPadding(dp(14), 0, dp(14), 0)
        if (secondary) {
            background = HostUi.rounded(this@MainActivity, Color.TRANSPARENT, 2, 0x69FFFFFF)
            setTextColor(Color.WHITE)
        } else {
            background = HostUi.rounded(this@MainActivity, 0xFFF7F8F3.toInt(), 2)
            // A fixed light button, so a fixed dark label in both themes.
            setTextColor(0xFF171A19.toInt())
        }
        setOnClickListener { onClick() }
    }

    private fun pauseOrResume() {
        startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_PAUSE))
        handler.postDelayed({ if (!isDestroyed) refreshStatus() }, 400)
    }

    private fun overviewRow(title: String, description: String, summary: String, onClick: () -> Unit): LinearLayout {
        val wrap = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        wrap.addView(HostUi.divider(this))
        val row = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(57)
            setPadding(dp(1), dp(7), dp(1), dp(7))
            isClickable = true
            isFocusable = true
            setOnClickListener { onClick() }
        }
        val texts = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(TextView(this).apply { text = title; textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(color(R.color.beacon_text)) })
        texts.addView(TextView(this).apply { text = description; textSize = 12f; setTextColor(color(R.color.beacon_muted)); setPadding(0, dp(4), 0, 0) })
        row.addView(texts, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        row.addView(TextView(this).apply {
            text = if (summary.isEmpty()) "›" else "$summary  ›"
            textSize = 12f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(color(R.color.beacon_muted))
        })
        wrap.addView(row)
        wrap.layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        return wrap
    }

    // ---- Access tab --------------------------------------------------------------------------------------------

    private fun subhead(kicker: String, title: String, copy: String) {
        root.addView(HostUi.kicker(this, kicker))
        root.addView(HostUi.headline(this, title, 44f))
        root.addView(HostUi.text(this, copy, 13f, false, true).apply { setPadding(0, dp(4), dp(40), dp(18)) })
    }

    private fun renderAccess() {
        subhead("Who can connect", "Access.", "Control how your phone can be reached from your workspace.")
        root.addView(HostUi.divider(this))
        val (accessRow, accessSwitch) = HostUi.switchRow(
            this, "Connect without asking",
            "Your account can view the phone without a prompt while it's unlocked. Pause and Stop remain available.",
            "access-toggle", identity.unattended,
        )
        accessSwitch.setOnClickListener {
            // The real state is set once the change has been applied; until then the switch shows what is true now.
            accessSwitch.isChecked = identity.unattended
            changeAccess()
        }
        accessRow.addView(HostUi.text(this, "Android 11+ · Up to 2 fps in unattended mode · No system audio", 11.5f, false, true).apply { setPadding(0, dp(10), 0, 0) })
        accessRow.addView(HostUi.text(this, "", 13f).apply {
            tag = "access-notice"
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
            val note = AccessIntents.notice?.takeIf { it.first == identity.accessBinding() }?.second.orEmpty()
            text = note
            visibility = if (note.isEmpty()) View.GONE else View.VISIBLE
            setPadding(0, dp(10), 0, 0)
        })
        root.addView(accessRow)
        root.addView(HostUi.divider(this))
        val (unlockRow, unlockSwitch) = HostUi.switchRow(
            this, "Unlock from a viewer",
            "Allow an unattended viewer to interact with the lock screen and enter your passcode. Beacon never saves it.",
            "unlock-toggle", identity.unlockFromViewer,
        )
        unlockSwitch.isEnabled = identity.unattended
        // Without access-without-asking there is nothing to unlock for, so the row is dimmed like the design.
        unlockRow.alpha = if (identity.unattended) 1f else 0.45f
        unlockSwitch.setOnClickListener {
            unlockSwitch.isChecked = identity.unlockFromViewer
            if (identity.unlockFromViewer) {
                identity.unlockFromViewer = false
                render()
            } else confirmUnlock()
        }
        root.addView(unlockRow)
        root.addView(HostUi.divider(this))
        val steps = setupSteps()
        val title = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(18), 0, dp(10)) }
        title.addView(TextView(this).apply { text = "Device setup"; textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(color(R.color.beacon_text)) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        title.addView(TextView(this).apply { text = "${steps.count { it.done }} of ${steps.size} complete"; textSize = 12f; setTextColor(color(R.color.beacon_muted)); tag = "setup-count" })
        root.addView(title)
        for (step in steps) root.addView(checkRow(step))
    }

    private fun checkRow(step: SetupStep): LinearLayout = LinearLayout(this).apply {
        gravity = Gravity.CENTER_VERTICAL
        minimumHeight = dp(44)
        tag = "setup-${step.title}"
        addView(TextView(context).apply {
            text = if (step.done) "✓" else ""
            textSize = 10f
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
            setTextColor(color(R.color.beacon_background))
            background = if (step.done) HostUi.rounded(this@MainActivity, color(R.color.beacon_text), 9)
            else GradientDrawableRing(this@MainActivity)
        }, LinearLayout.LayoutParams(dp(18), dp(18)).apply { marginEnd = dp(10) })
        addView(TextView(context).apply {
            text = step.title
            textSize = 13f
            setTextColor(color(if (step.done) R.color.beacon_text else R.color.beacon_muted))
        }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        if (!step.done) {
            addView(TextView(context).apply {
                text = "Set up"
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
                setTextColor(color(R.color.beacon_accent))
            })
            isClickable = true
            isFocusable = true
            setOnClickListener { step.action() }
        }
    }

    @Suppress("FunctionName")
    private fun GradientDrawableRing(activity: Activity) = HostUi.rounded(activity, Color.TRANSPARENT, 9, 0xFFAEB4AD.toInt())

    private fun confirmUnlock() {
        HostUi.sheet(this) { panel, close ->
            panel.addView(HostUi.headline(this, "Allow remote unlocking?", 27f))
            panel.addView(HostUi.text(this, "An unattended viewer may see and use your phone's lock screen, including entering your passcode. Beacon does not store or log your passcode.", 13f, false, true).apply { setPadding(0, dp(8), 0, dp(18)) })
            val buttons = LinearLayout(this)
            buttons.addView(HostUi.button(this, "Cancel").apply { setOnClickListener { close() } }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(4) })
            buttons.addView(HostUi.button(this, "Allow unlocking", true).apply {
                setOnClickListener {
                    identity.unlockFromViewer = true
                    close()
                    render()
                }
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(4) })
            panel.addView(buttons)
        }.show()
    }

    // ---- Privacy tab -------------------------------------------------------------------------------------------

    private fun clipboardName(mode: String) = when (mode) { "off" -> "Off"; "auto" -> "Automatic"; else -> "Button only" }

    private fun clipboardWords(mode: String) = when (mode) {
        "off" -> "Nothing on the clipboard is shared with a viewer."
        "auto" -> "Copied content moves both ways while a viewer is connected."
        else -> "Copied content moves only when the viewer presses a button."
    }

    private fun renderPrivacy() {
        subhead("Shared information", "Privacy.", "Choose what a connected viewer can receive.")
        root.addView(HostUi.divider(this))
        root.addView(HostUi.text(this, "Clipboard", 17f, true).apply { setPadding(0, dp(18), 0, dp(12)) })
        val segmented = LinearLayout(this).apply {
            tag = "clipboard-mode"
            setPadding(dp(4), dp(4), dp(4), dp(4))
            background = HostUi.rounded(this@MainActivity, color(R.color.beacon_soft), 5)
        }
        for ((mode, label) in listOf("auto" to "Automatic", "button" to "Button only", "off" to "Off")) {
            val selected = identity.clipboardMode == mode
            segmented.addView(TextView(this).apply {
                text = label
                textSize = 12f
                typeface = Typeface.DEFAULT_BOLD
                gravity = Gravity.CENTER
                tag = "clipboard-$mode"
                minHeight = dp(40)
                setTextColor(color(if (selected) R.color.beacon_text else R.color.beacon_muted))
                background = if (selected) HostUi.rounded(this@MainActivity, color(R.color.beacon_surface), 3) else null
                isClickable = true
                setOnClickListener {
                    identity.clipboardMode = mode
                    render()
                }
            }, LinearLayout.LayoutParams(0, dp(40), 1f).apply { marginStart = dp(2); marginEnd = dp(2) })
        }
        root.addView(segmented)
        root.addView(HostUi.text(this, clipboardWords(identity.clipboardMode), 12f, false, true).apply { setPadding(0, dp(10), 0, dp(18)) })
        root.addView(HostUi.divider(this))
        val granted = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val (soundRow, soundSwitch) = HostUi.switchRow(
            this, "Phone sound",
            "Let approved attended viewers hear audio from your apps. This does not include your microphone.",
            "sound-toggle", identity.shareSound && granted,
        )
        soundSwitch.setOnClickListener {
            soundSwitch.isChecked = identity.shareSound && granted
            when {
                identity.shareSound -> { identity.shareSound = false; render() }
                granted -> { identity.shareSound = true; render() }
                else -> requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 2)
            }
        }
        root.addView(soundRow)
        root.addView(HostUi.divider(this))
        val (micRow, micSwitch) = HostUi.switchRow(
            this, "Microphone",
            "Trusted viewers can hear your phone's microphone, even while it's locked. Android shows when it's in use.",
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
        root.addView(HostUi.text(this, "Receiving files is approved for each attended request. Files are saved to Downloads/Beacon Remote.", 11.5f, false, true).apply { setPadding(0, dp(14), 0, 0) })
    }

    // ---- Sheets ------------------------------------------------------------------------------------------------

    private fun showMenu() {
        if (!identity.paired) return
        HostUi.sheet(this) { panel, close ->
            panel.addView(HostUi.headline(this, "More options", 27f))
            fun choice(label: String, danger: Boolean, action: () -> Unit) {
                panel.addView(HostUi.divider(this))
                panel.addView(TextView(this).apply {
                    text = label
                    textSize = 14f
                    typeface = Typeface.DEFAULT_BOLD
                    setTextColor(color(if (danger) R.color.beacon_danger else R.color.beacon_text))
                    setPadding(0, dp(16), 0, dp(16))
                    isClickable = true
                    setOnClickListener { close(); action() }
                })
            }
            choice("Connection details", false) { showDetails() }
            choice("Remove device", true) { confirmRemove() }
        }.show()
    }

    private fun showDetails() {
        HostUi.sheet(this) { panel, close ->
            panel.addView(HostUi.headline(this, "Connection details", 27f))
            panel.addView(HostUi.text(this, "This phone communicates with your Beacon Remote workspace through the following address.", 13f, false, true).apply { setPadding(0, dp(8), 0, dp(18)) })
            panel.addView(HostUi.text(this, "Server", 12f, false, true).apply { setPadding(0, 0, 0, dp(6)) })
            panel.addView(HostUi.divider(this))
            val row = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL; setPadding(0, dp(14), 0, dp(14)) }
            row.addView(TextView(this).apply { text = identity.server; textSize = 12f; typeface = Typeface.DEFAULT_BOLD; setTextColor(color(R.color.beacon_text)) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
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
                textSize = 13f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(color(R.color.beacon_danger))
                setPadding(0, dp(18), 0, 0)
                isClickable = true
                setOnClickListener { close(); confirmRemove() }
            })
        }.show()
    }

    private fun confirmRemove() {
        HostUi.sheet(this) { panel, close ->
            panel.addView(HostUi.headline(this, "Remove this device?", 27f))
            panel.addView(HostUi.text(this, "This stops sharing and removes the local pairing. To remove the workspace entry, remove this device from your workspace separately.", 13f, false, true).apply { setPadding(0, dp(8), 0, dp(18)) })
            val buttons = LinearLayout(this)
            buttons.addView(HostUi.button(this, "Cancel").apply { setOnClickListener { close() } }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginEnd = dp(4) })
            buttons.addView(HostUi.button(this, "Remove device", true).apply {
                tag = "confirm-remove"
                background = HostUi.rounded(this@MainActivity, color(R.color.beacon_danger), 4)
                setTextColor(Color.WHITE)
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

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, results: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, results)
        if (requestCode == 3) {
            identity.shareMic = results.firstOrNull() == PackageManager.PERMISSION_GRANTED
            render()
            return
        }
        if (requestCode == 2) {
            identity.shareSound = results.firstOrNull() == PackageManager.PERMISSION_GRANTED
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
                "Lets an approved viewer touch and type. It does nothing outside a session you approve.",
                hint = "If Android says the setting is restricted: open App info, tap ⋮ (top right), choose Allow restricted settings, then come back.",
            ) { openAccessibilityPage() }
        }
        val power = getSystemService(android.os.PowerManager::class.java)
        list += SetupStep(
            "Background running allowed", "Allow background running", power.isIgnoringBatteryOptimizations(packageName),
            "Keeps this phone reachable when the screen is off.",
        ) { requestBatteryExemption() }
        list += SetupStep(
            "Access without asking allowed", "Allow access without asking", identity.unattended,
            "Lets your account connect without a prompt while this phone is unlocked. Pause and Stop stay visible.",
        ) { changeAccess() }
        return list
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

    /** The card on the Device tab until setup is done: where you are, what is next, and one button that does it. */
    private fun setupCard(): LinearLayout? {
        val steps = setupSteps()
        val next = steps.firstOrNull { !it.done } ?: return null
        val card = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            tag = "setup-card"
            setPadding(dp(18), dp(16), dp(18), dp(18))
            background = HostUi.rounded(this@MainActivity, color(R.color.beacon_surface), 4, color(R.color.beacon_line))
        }
        val top = LinearLayout(this).apply { gravity = Gravity.CENTER_VERTICAL }
        top.addView(TextView(this).apply { text = "Finish setup"; textSize = 14f; typeface = Typeface.DEFAULT_BOLD; setTextColor(color(R.color.beacon_text)) }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(TextView(this).apply { text = "${steps.count { it.done }} of ${steps.size}"; textSize = 12f; setTextColor(color(R.color.beacon_muted)) })
        card.addView(top)
        val bars = LinearLayout(this).apply { setPadding(0, dp(12), 0, dp(14)) }
        for ((index, step) in steps.withIndex()) {
            bars.addView(View(this).apply {
                setBackgroundColor(color(if (step.done) R.color.beacon_accent else R.color.beacon_line))
            }, LinearLayout.LayoutParams(0, dp(4), 1f).apply { if (index > 0) marginStart = dp(4) })
        }
        card.addView(bars)
        card.addView(TextView(this).apply { text = next.title.replace(" allowed", "").replace(" enabled", ""); textSize = 17f; typeface = Typeface.DEFAULT_BOLD; letterSpacing = -0.02f; setTextColor(color(R.color.beacon_text)) })
        card.addView(HostUi.text(this, next.why, 12.5f, false, true).apply { setPadding(0, dp(6), 0, dp(14)) })
        next.hint?.let { hint ->
            card.addView(HostUi.text(this, hint, 11.5f, false, true).apply { setPadding(0, 0, 0, dp(4)) })
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

    /** Everything on a paired screen that can change by itself. When it changes the screen is drawn again. */
    private fun currentSignature(): String = listOf(
        identity.paired, page, HostState.status, HostState.sharing, HostState.paused, HostState.controlling, identity.wantsAvailable,
        identity.unattended, identity.unlockFromViewer, identity.clipboardMode, identity.shareSound, identity.shareMic,
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
        @Volatile var pairingNotice: String? = null
        @Volatile var page = "device"
    }
}

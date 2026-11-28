package com.beaconremote.host

import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.graphics.drawable.StateListDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.Window
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import androidx.core.view.AccessibilityDelegateCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.accessibility.AccessibilityNodeInfoCompat

/**
 * Shared look for the app, the same identity as the web workspace (design/DIRECTION.md): warm paper, ink text, one
 * brand blue, tint tiles with large radii and no borders, black pill buttons, Atkinson Hyperlegible Next at heavy
 * weights for headings. Native views only, readable columns, safe-area / keyboard insets, and 48 dp touch targets.
 * Every screen is built from these so they stay in step.
 */
object HostUi {
    fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    fun color(activity: Activity, id: Int) = activity.getColor(id)

    private val faces = HashMap<Int, Typeface>()

    /** Atkinson Hyperlegible Next at [weight] (400 body, 700 labels and buttons, 800 headings). */
    fun font(context: Context, weight: Int): Typeface = faces.getOrPut(weight) {
        val family = runCatching { context.resources.getFont(R.font.atkinson_next) }.getOrNull() ?: Typeface.SANS_SERIF
        if (Build.VERSION.SDK_INT >= 28) Typeface.create(family, weight, false)
        else Typeface.create(family, if (weight >= 600) Typeface.BOLD else Typeface.NORMAL)
    }

    /** Atkinson Hyperlegible Mono, only for real codes and IDs. */
    fun mono(context: Context): Typeface = faces.getOrPut(-700) {
        runCatching { context.resources.getFont(R.font.atkinson_mono) }.getOrNull() ?: Typeface.MONOSPACE
    }

    fun bold(context: Context) = font(context, 700)
    fun heavy(context: Context) = font(context, 800)

    fun rounded(activity: Activity, fill: Int, radiusDp: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(activity, radiusDp).toFloat()
        if (stroke != null) setStroke(dp(activity, 1), stroke)
    }

    /** A pill: fully rounded whatever its height, so it stays a pill when large text makes it taller. */
    fun pill(activity: Activity, fill: Int, stroke: Int? = null) = rounded(activity, fill, 999, stroke)

    /** A tile: a tinted block with a large radius and no border or shadow at rest. */
    fun tile(activity: Activity, fill: Int, radiusDp: Int = 28) = rounded(activity, fill, radiusDp)

    fun column(activity: Activity) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        val horizontal = maxOf(22, (activity.resources.configuration.screenWidthDp - 600) / 2)
        setPadding(dp(activity, horizontal), dp(activity, 4), dp(activity, horizontal), dp(activity, 28))
    }

    fun text(activity: Activity, value: String, size: Float = 15f, bold: Boolean = false, secondary: Boolean = false) = TextView(activity).apply {
        text = value
        textSize = size
        setTextColor(activity.getColor(if (secondary) R.color.beacon_muted else R.color.beacon_text))
        setLineSpacing(0f, 1.18f)
        typeface = if (bold) bold(activity) else font(activity, 400)
        setPadding(0, 0, 0, dp(activity, 12))
    }

    /** A small sentence-case label above a headline. Never tracked uppercase. */
    fun kicker(activity: Activity, value: String) = text(activity, value, 14f, true, true).apply { setPadding(0, dp(activity, 14), 0, dp(activity, 4)) }

    /** Big, confident, tight headline at weight 800, as on the web. */
    fun headline(activity: Activity, value: String, size: Float = 34f) = TextView(activity).apply {
        text = value
        textSize = size
        typeface = heavy(activity)
        letterSpacing = -0.035f
        setLineSpacing(0f, 1.04f)
        setTextColor(activity.getColor(R.color.beacon_text))
        setPadding(0, 0, 0, dp(activity, 6))
        ViewCompat.setAccessibilityHeading(this, true)
    }

    /** The web workspace's brand: the mark, then "Beacon" heavy and "Remote" in the muted regular weight. */
    fun brand(activity: Activity): LinearLayout = LinearLayout(activity).apply {
        gravity = Gravity.CENTER_VERTICAL
        contentDescription = "Beacon Remote"
        addView(android.widget.ImageView(activity).apply { setImageResource(R.drawable.beacon_mark); importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO },
            LinearLayout.LayoutParams(dp(activity, 32), dp(activity, 32)).apply { marginEnd = dp(activity, 10) })
        addView(TextView(activity).apply {
            val name = android.text.SpannableStringBuilder("Beacon Remote")
            name.setSpan(android.text.style.ForegroundColorSpan(activity.getColor(R.color.beacon_muted)), 7, name.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            if (Build.VERSION.SDK_INT >= 28) name.setSpan(android.text.style.TypefaceSpan(font(activity, 400)), 7, name.length, android.text.Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            text = name
            textSize = 20f
            typeface = heavy(activity)
            letterSpacing = -0.035f
            setTextColor(activity.getColor(R.color.beacon_text))
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
        })
    }

    fun divider(activity: Activity) = View(activity).apply {
        setBackgroundColor(activity.getColor(R.color.beacon_line))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
    }

    /** Pill buttons, 48 dp tall: ink (primary) or tile (secondary). */
    fun button(activity: Activity, value: String, primary: Boolean = false) = Button(activity).apply {
        text = value
        isAllCaps = false
        textSize = 15f
        typeface = bold(activity)
        minHeight = dp(activity, 48)
        minimumHeight = dp(activity, 48)
        stateListAnimator = null
        setPadding(dp(activity, 22), dp(activity, 6), dp(activity, 22), dp(activity, 6))
        val normal = pill(activity, activity.getColor(if (primary) R.color.beacon_ink else R.color.beacon_tile))
        val off = pill(activity, activity.getColor(R.color.beacon_tile))
        background = StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), off)
            addState(intArrayOf(), normal)
        }
        setTextColor(ColorStateList(
            arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(activity.getColor(R.color.beacon_muted), activity.getColor(if (primary) R.color.beacon_on_ink else R.color.beacon_text)),
        ))
        pressable(this)
    }

    /** Buttons press to 96%, as on the web. */
    fun pressable(view: View) {
        view.setOnTouchListener { touched, event ->
            when (event.actionMasked) {
                android.view.MotionEvent.ACTION_DOWN -> touched.animate().scaleX(0.96f).scaleY(0.96f).setDuration(60).start()
                android.view.MotionEvent.ACTION_UP, android.view.MotionEvent.ACTION_CANCEL -> touched.animate().scaleX(1f).scaleY(1f).setDuration(160).start()
            }
            false
        }
    }

    /** A plain underlined text button, such as "Go offline". It is a Button so existing hooks keep working; 48 dp tall to touch. */
    fun link(activity: Activity, value: String) = Button(activity).apply {
        text = value
        isAllCaps = false
        textSize = 14f
        typeface = bold(activity)
        background = null
        stateListAnimator = null
        minHeight = dp(activity, 48)
        minimumHeight = dp(activity, 48)
        minWidth = dp(activity, 48)
        minimumWidth = dp(activity, 48)
        setPadding(0, 0, 0, 0)
        paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
        setTextColor(activity.getColor(R.color.beacon_accent_text))
    }

    /** The on/off switch: brand blue when on, grey when off. A Switch is a Button, so tags and clicks behave as before. */
    fun switch(activity: Activity, label: String) = Switch(activity).apply {
        contentDescription = label
        showText = false
        val track = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_checked), pill(activity, activity.getColor(R.color.beacon_accent)).apply { setSize(dp(activity, 50), dp(activity, 30)) })
            addState(intArrayOf(), pill(activity, activity.getColor(R.color.beacon_line_strong)).apply { setSize(dp(activity, 50), dp(activity, 30)) })
        }
        val thumb = InsetDrawable(
            GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.WHITE)
                setSize(dp(activity, 30), dp(activity, 30))
            },
            dp(activity, 4),
        )
        setTrackDrawable(track)
        setThumbDrawable(thumb)
        trackTintList = null
        thumbTintList = null
        minimumHeight = dp(activity, 48)
        minHeight = dp(activity, 48)
        minimumWidth = dp(activity, 48)
    }

    /** A titled setting with a switch on the right and a description underneath. Returns the row and its switch. */
    fun switchRow(activity: Activity, title: String, description: String, tag: String?, checked: Boolean): Pair<LinearLayout, Switch> {
        val toggle = switch(activity, title).apply {
            isChecked = checked
            if (tag != null) this.tag = tag
        }
        val head = LinearLayout(activity).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(TextView(activity).apply {
                text = title
                textSize = 18f
                typeface = bold(activity)
                letterSpacing = -0.012f
                setTextColor(activity.getColor(R.color.beacon_text))
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(toggle)
        }
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(activity, 14), 0, dp(activity, 16))
            addView(head)
            addView(text(activity, description, 14f, false, true).apply { setPadding(0, dp(activity, 4), dp(activity, 24), 0) })
        }
        return row to toggle
    }

    /**
     * A segmented choice on a tile track: the chosen option is an ink pill. Each option grows with its text (never a
     * fixed height, so a 200% font cannot clip it), is at least 48 dp tall, and reads as a selected radio button.
     */
    fun segmented(activity: Activity, options: List<Pair<String, String>>, chosen: String, tagPrefix: String, onChoose: (String) -> Unit): LinearLayout {
        // Side by side while every label fits its share on one line; stacked otherwise (large fonts, narrow screens), so a
        // word is never broken in the middle.
        val paint = android.text.TextPaint().apply {
            typeface = bold(activity)
            textSize = android.util.TypedValue.applyDimension(android.util.TypedValue.COMPLEX_UNIT_SP, 14f, activity.resources.displayMetrics)
        }
        val horizontal = maxOf(22, (activity.resources.configuration.screenWidthDp - 600) / 2)
        val trackWidth = dp(activity, minOf(activity.resources.configuration.screenWidthDp, 600) - 2 * horizontal - 8)
        val stacked = options.any { (_, label) -> paint.measureText(label) + dp(activity, 16) > trackWidth / options.size }
        val track = LinearLayout(activity).apply {
            orientation = if (stacked) LinearLayout.VERTICAL else LinearLayout.HORIZONTAL
            setPadding(dp(activity, 4), dp(activity, 4), dp(activity, 4), dp(activity, 4))
            background = tile(activity, activity.getColor(R.color.beacon_tile), 26)
        }
        for ((value, label) in options) {
            val selected = value == chosen
            track.addView(TextView(activity).apply {
                text = label
                textSize = 14f
                typeface = bold(activity)
                gravity = Gravity.CENTER
                tag = "$tagPrefix-$value"
                minHeight = dp(activity, 48)
                setPadding(dp(activity, 6), dp(activity, 8), dp(activity, 6), dp(activity, 8))
                setTextColor(activity.getColor(if (selected) R.color.beacon_on_ink else R.color.beacon_muted))
                background = if (selected) pill(activity, activity.getColor(R.color.beacon_ink)) else null
                isSelected = selected
                isClickable = true
                isFocusable = true
                role(this, android.widget.RadioButton::class.java.name, checked = selected)
                setOnClickListener { if (!selected) onChoose(value) }
            }, if (stacked) LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            else LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        }
        return track
    }

    /**
     * What a custom control is to TalkBack: its class (Button, RadioButton...), whether it is checked or selected, and
     * an optional spoken role ("Tab").
     */
    fun role(view: View, className: String, checked: Boolean? = null, selected: Boolean? = null, roleDescription: String? = null) {
        ViewCompat.setAccessibilityDelegate(view, object : AccessibilityDelegateCompat() {
            override fun onInitializeAccessibilityNodeInfo(host: View, info: AccessibilityNodeInfoCompat) {
                super.onInitializeAccessibilityNodeInfo(host, info)
                info.className = className
                if (checked != null) { info.isCheckable = true; info.isChecked = checked }
                if (selected != null) info.isSelected = selected
                if (roleDescription != null) info.roleDescription = roleDescription
            }
        })
    }

    /** A bottom sheet: paper panel with large top corners and a close button. [build] fills it; call the given function to close it. */
    fun sheet(activity: Activity, build: (LinearLayout, () -> Unit) -> Unit): Dialog {
        val dialog = Dialog(activity)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(activity, 24), dp(activity, 12), dp(activity, 24), dp(activity, 26))
            background = GradientDrawable().apply {
                setColor(activity.getColor(R.color.beacon_background))
                val r = dp(activity, 28).toFloat()
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
        }
        val close = TextView(activity).apply {
            text = "×"
            // An icon in a fixed-size circle is sized in dp, so a large system font cannot push it out of the circle.
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_DIP, 24f)
            includeFontPadding = false
            gravity = Gravity.CENTER
            contentDescription = "Close"
            setTextColor(activity.getColor(R.color.beacon_text))
            // A 36 dp circle inside a 48 dp touch target.
            background = InsetDrawable(pill(activity, activity.getColor(R.color.beacon_tile)), dp(activity, 6))
            role(this, Button::class.java.name)
            setOnClickListener { dialog.dismiss() }
        }
        panel.addView(close, LinearLayout.LayoutParams(dp(activity, 48), dp(activity, 48)).apply { gravity = Gravity.END; marginEnd = -dp(activity, 6) })
        build(panel) { dialog.dismiss() }
        // Scrollable, so a large font size or a short landscape screen never clips the content or the close button.
        val scroll = ScrollView(activity).apply {
            isFillViewport = false
            addView(panel, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        dialog.setContentView(scroll)
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setGravity(Gravity.BOTTOM)
            // Full width on a phone; the same readable 600 dp column as the screens on a tablet.
            val screenWidth = activity.resources.displayMetrics.widthPixels
            setLayout(minOf(screenWidth, dp(activity, 600)), ViewGroup.LayoutParams.WRAP_CONTENT)
            setDimAmount(0.4f)
        }
        return dialog
    }

    /**
     * Sets the screen: an optional fixed [header], the scrolling [content], and an optional fixed [footer]. Handles the
     * safe-area and keyboard insets.
     */
    fun screen(activity: Activity, content: LinearLayout, footer: View? = null, header: View? = null) {
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        val outer = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(activity.getColor(R.color.beacon_background))
        }
        header?.let { outer.addView(it) }
        val scroll = ScrollView(activity).apply {
            isFillViewport = true
            addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        outer.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        footer?.let { outer.addView(it) }
        activity.setContentView(outer)
        // Dark icons on the light design, light icons on the dark one.
        val light = activity.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK != android.content.res.Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(activity.window, outer).apply {
            isAppearanceLightStatusBars = light
            isAppearanceLightNavigationBars = light
        }
        ViewCompat.setOnApplyWindowInsetsListener(outer) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime())
            view.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, keyboard.bottom))
            insets
        }
        ViewCompat.requestApplyInsets(outer)
    }
}

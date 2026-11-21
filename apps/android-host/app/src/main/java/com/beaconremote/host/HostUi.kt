package com.beaconremote.host

import android.app.Activity
import android.app.Dialog
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Shared look for the app: paper background, ink text, one blue. Native views only, readable columns, and
 * safe-area / keyboard insets. Every screen is built from these so they stay in step.
 */
object HostUi {
    fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()

    fun color(activity: Activity, id: Int) = activity.getColor(id)

    fun rounded(activity: Activity, fill: Int, radiusDp: Int, stroke: Int? = null): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = dp(activity, radiusDp).toFloat()
        if (stroke != null) setStroke(dp(activity, 1), stroke)
    }

    fun column(activity: Activity) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        val horizontal = maxOf(25, (activity.resources.configuration.screenWidthDp - 600) / 2)
        setPadding(dp(activity, horizontal), dp(activity, 4), dp(activity, horizontal), dp(activity, 24))
    }

    fun text(activity: Activity, value: String, size: Float = 15f, bold: Boolean = false, secondary: Boolean = false) = TextView(activity).apply {
        text = value
        textSize = size
        setTextColor(activity.getColor(if (secondary) R.color.beacon_muted else R.color.beacon_text))
        setLineSpacing(0f, 1.12f)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        setPadding(0, 0, 0, dp(activity, 12))
    }

    /** The small grey label above a headline. */
    fun kicker(activity: Activity, value: String) = text(activity, value, 12f, true, true).apply { setPadding(0, dp(activity, 14), 0, dp(activity, 4)) }

    /** Large tight headline, as in the design. */
    fun headline(activity: Activity, value: String, size: Float = 40f) = TextView(activity).apply {
        text = value
        textSize = size
        typeface = Typeface.DEFAULT_BOLD
        letterSpacing = -0.04f
        setLineSpacing(0f, 0.98f)
        setTextColor(activity.getColor(R.color.beacon_text))
        setPadding(0, 0, 0, dp(activity, 6))
    }

    fun divider(activity: Activity) = View(activity).apply {
        setBackgroundColor(activity.getColor(R.color.beacon_line))
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 1)
    }

    /** Buttons: ink (primary) or soft grey (secondary), square-ish corners, 48 dp tall. */
    fun button(activity: Activity, value: String, primary: Boolean = false) = Button(activity).apply {
        text = value
        isAllCaps = false
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        minHeight = dp(activity, 48)
        minimumHeight = dp(activity, 48)
        stateListAnimator = null
        val normal = rounded(activity, activity.getColor(if (primary) R.color.beacon_text else R.color.beacon_soft), 4)
        val off = rounded(activity, activity.getColor(R.color.beacon_soft), 4)
        background = StateListDrawable().apply {
            addState(intArrayOf(-android.R.attr.state_enabled), off)
            addState(intArrayOf(), normal)
        }
        setTextColor(ColorStateList(
            arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(activity.getColor(R.color.beacon_muted), activity.getColor(if (primary) R.color.beacon_on_accent else R.color.beacon_text)),
        ))
    }

    /** A plain underlined text button, such as "Go offline". It is a Button so existing hooks keep working. */
    fun link(activity: Activity, value: String) = Button(activity).apply {
        text = value
        isAllCaps = false
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        background = null
        stateListAnimator = null
        minHeight = 0
        minimumHeight = dp(activity, 40)
        setPadding(0, 0, 0, 0)
        paintFlags = paintFlags or android.graphics.Paint.UNDERLINE_TEXT_FLAG
        setTextColor(activity.getColor(R.color.beacon_text))
    }

    /** The on/off switch: blue when on, grey when off. A Switch is a Button, so tags and clicks behave as before. */
    fun switch(activity: Activity, label: String) = Switch(activity).apply {
        contentDescription = label
        showText = false
        thumbTintList = ColorStateList.valueOf(activity.getColor(R.color.beacon_surface))
        trackTintList = ColorStateList(
            arrayOf(intArrayOf(android.R.attr.state_checked), intArrayOf()),
            intArrayOf(activity.getColor(R.color.beacon_accent), activity.getColor(R.color.beacon_switch_off)),
        )
        minimumHeight = dp(activity, 40)
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
                textSize = 17f
                typeface = Typeface.DEFAULT_BOLD
                letterSpacing = -0.02f
                setTextColor(activity.getColor(R.color.beacon_text))
            }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
            addView(toggle)
        }
        val row = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(0, dp(activity, 16), 0, dp(activity, 16))
            addView(head)
            addView(text(activity, description, 12.5f, false, true).apply { setPadding(0, dp(activity, 8), dp(activity, 30), 0) })
        }
        return row to toggle
    }

    /** A bottom sheet: rounded paper panel with a close button. [build] fills it; call the given function to close it. */
    fun sheet(activity: Activity, build: (LinearLayout, () -> Unit) -> Unit): Dialog {
        val dialog = Dialog(activity)
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE)
        val panel = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(activity, 25), dp(activity, 16), dp(activity, 25), dp(activity, 26))
            background = GradientDrawable().apply {
                setColor(activity.getColor(R.color.beacon_background))
                val r = dp(activity, 12).toFloat()
                cornerRadii = floatArrayOf(r, r, r, r, 0f, 0f, 0f, 0f)
            }
        }
        val close = TextView(activity).apply {
            text = "×"
            textSize = 22f
            gravity = Gravity.CENTER
            contentDescription = "Close"
            setTextColor(activity.getColor(R.color.beacon_text))
            background = rounded(activity, activity.getColor(R.color.beacon_soft), 16)
            setOnClickListener { dialog.dismiss() }
        }
        panel.addView(close, LinearLayout.LayoutParams(dp(activity, 32), dp(activity, 32)).apply { gravity = Gravity.END; bottomMargin = dp(activity, 6) })
        build(panel) { dialog.dismiss() }
        dialog.setContentView(panel)
        dialog.window?.apply {
            setBackgroundDrawableResource(android.R.color.transparent)
            setGravity(Gravity.BOTTOM)
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
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
        val outer = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
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

package com.beaconremote.host

import android.app.Activity
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Typeface
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/** Shared native typography, readable columns and safe-area/keyboard insets. */
object HostUi {
    fun dp(activity: Activity, value: Int) = (value * activity.resources.displayMetrics.density).toInt()
    fun column(activity: Activity) = LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        val horizontal = maxOf(20, (activity.resources.configuration.screenWidthDp - 600) / 2)
        setPadding(dp(activity, horizontal), dp(activity, 24), dp(activity, horizontal), dp(activity, 24))
    }
    fun text(activity: Activity, value: String, size: Float = 15f, bold: Boolean = false, secondary: Boolean = false) = TextView(activity).apply {
        text = value
        textSize = size
        setTextColor(activity.getColor(if (secondary) R.color.beacon_muted else R.color.beacon_text))
        setLineSpacing(0f, 1.12f)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        setPadding(0, 0, 0, dp(activity, 12))
    }
    fun button(activity: Activity, value: String, primary: Boolean = false) = Button(activity).apply {
        text = value
        isAllCaps = false
        textSize = 15f
        minHeight = dp(activity, 48)
        backgroundTintList = ColorStateList(
            arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(activity.getColor(R.color.beacon_soft), activity.getColor(if (primary) R.color.beacon_accent else R.color.beacon_surface)),
        )
        setTextColor(ColorStateList(
            arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
            intArrayOf(activity.getColor(R.color.beacon_muted), activity.getColor(if (primary) R.color.beacon_on_accent else R.color.beacon_accent)),
        ))
    }
    fun screen(activity: Activity, content: LinearLayout, footer: View? = null) {
        WindowCompat.setDecorFitsSystemWindows(activity.window, false)
        activity.window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        val outer = LinearLayout(activity).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(activity).apply {
            isFillViewport = true
            addView(content, ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        }
        outer.addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        footer?.let { outer.addView(it) }
        activity.setContentView(outer)
        val light = activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK != Configuration.UI_MODE_NIGHT_YES
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

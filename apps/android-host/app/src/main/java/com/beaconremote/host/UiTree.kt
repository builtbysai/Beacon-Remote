package com.beaconremote.host

import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject

/**
 * Reads the interface tree of the active window for the semantic-target tool (ADR 0064), in the same raw shape the
 * Windows reader and `tools/mcp/src/ui-snapshot.mjs` use: role, name, state and bounds, with children.
 *
 * It reads only. It never reads what a person typed: an editable field's name is its label (content description or
 * hint), never its text, and a password field keeps its role and nothing else. Nothing calls it yet: no tool or channel
 * exposes it.
 */
internal object UiTree {
    const val MAX_NODES = 500
    const val MAX_DEPTH = 12
    const val MAX_NAME = 120

    /** What a node says about itself, so the rules below can be tested without Android. */
    internal interface Source {
        val className: String?
        val text: String?
        val label: String?
        val hint: String?
        val editable: Boolean
        val password: Boolean
        val enabled: Boolean
        val focused: Boolean
        val checked: Boolean
        val visible: Boolean
        val bounds: IntArray // left, top, right, bottom
        val childCount: Int
        fun child(index: Int): Source?

        /** Gives the node back to Android once it has been read (needed before Android 13). */
        fun release() {}
    }

    internal class Raw(
        val role: String,
        val name: String?,
        val protected: Boolean,
        val states: List<String>,
        val bounds: IntArray,
        val children: List<Raw>,
    )

    /** The role word for an Android widget class name. */
    fun role(className: String?): String {
        val name = className.orEmpty()
        val last = name.substringAfterLast('.')
        return when {
            last == "Button" || last == "ImageButton" || last == "AppCompatButton" || last == "MaterialButton" -> "button"
            last == "EditText" || last == "AutoCompleteTextView" || last == "TextInputEditText" -> "edit"
            last == "CheckBox" || last == "Switch" || last == "SwitchCompat" || last == "ToggleButton" -> "checkbox"
            last == "RadioButton" -> "radiobutton"
            last == "TextView" || last == "CheckedTextView" -> "text"
            last == "ImageView" -> "image"
            last == "Spinner" -> "combobox"
            last == "SeekBar" -> "slider"
            last == "ProgressBar" -> "progressbar"
            last == "TabWidget" || last == "TabLayout" -> "tab"
            last == "ListView" || last == "RecyclerView" || last == "GridView" -> "list"
            last == "WebView" -> "document"
            last == "ScrollView" || last == "HorizontalScrollView" || last == "NestedScrollView" -> "pane"
            last.endsWith("Layout") || last == "ViewGroup" || last == "View" -> "group"
            else -> "unknown"
        }
    }

    /**
     * A node's name. An editable field is named only by its label or hint, never by its text, because its text is what the
     * person typed. Anything else is named by its label, else its text.
     */
    fun name(source: Source): String? {
        val raw =
            if (source.editable) source.label?.takeIf { it.isNotBlank() } ?: source.hint
            else source.label?.takeIf { it.isNotBlank() } ?: source.text
        return raw?.takeIf { it.isNotBlank() }?.take(MAX_NAME)
    }

    fun build(source: Source, depth: Int = 0, count: IntArray = intArrayOf(0)): Raw {
        count[0]++
        val secret = source.password
        val states = buildList {
            add(if (source.enabled) "enabled" else "disabled")
            if (source.focused) add("focused")
            if (source.checked) add("checked")
            if (!source.visible) add("offscreen")
        }
        val children = mutableListOf<Raw>()
        if (depth < MAX_DEPTH) {
            for (index in 0 until source.childCount) {
                if (count[0] >= MAX_NODES) break
                val child = source.child(index) ?: continue
                try {
                    children += build(child, depth + 1, count)
                } finally {
                    child.release()
                }
            }
        }
        return Raw(
            role = if (secret) "password" else role(source.className),
            name = if (secret) null else name(source),
            protected = secret,
            states = states,
            bounds = source.bounds,
            children = children,
        )
    }

    fun toJson(raw: Raw): JSONObject =
        JSONObject().apply {
            put("role", raw.role)
            put("protected", raw.protected)
            raw.name?.let { put("name", it) }
            put("states", JSONArray(raw.states))
            val (left, top, right, bottom) = raw.bounds.toList()
            put(
                "bounds",
                JSONObject()
                    .put("x", left)
                    .put("y", top)
                    .put("width", maxOf(0, right - left))
                    .put("height", maxOf(0, bottom - top)),
            )
            put("children", JSONArray(raw.children.map { toJson(it) }))
        }

    /** A tree and whether the node limit cut it short. */
    internal class Read(val tree: JSONObject, val truncated: Boolean)

    /** The active window's tree, or null when there is none. The caller owns [root] and releases it as usual. */
    fun read(root: AccessibilityNodeInfo?): Read? {
        if (root == null) return null
        val count = intArrayOf(0)
        val raw = build(Node(root), 0, count)
        return Read(toJson(raw), count[0] >= MAX_NODES)
    }

    private class Node(private val info: AccessibilityNodeInfo) : Source {
        override val className get() = info.className?.toString()
        override val text get() = info.text?.toString()
        override val label get() = info.contentDescription?.toString()
        override val hint get() = info.hintText?.toString()
        override val editable get() = info.isEditable
        override val password get() = info.isPassword
        override val enabled get() = info.isEnabled
        override val focused get() = info.isFocused
        override val checked get() = info.isChecked
        override val visible get() = info.isVisibleToUser
        override val bounds: IntArray
            get() = android.graphics.Rect().also { info.getBoundsInScreen(it) }.let { intArrayOf(it.left, it.top, it.right, it.bottom) }
        override val childCount get() = info.childCount
        override fun child(index: Int): Source? =
            info.getChild(index)?.let { Node(it) }

        @Suppress("DEPRECATION")
        override fun release() {
            if (android.os.Build.VERSION.SDK_INT < 33) info.recycle()
        }
    }
}

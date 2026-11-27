package com.beaconremote.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rules for what an agent may be told about the screen (ADR 0064), checked without Android. */
class UiTreeTest {
    private class Fake(
        override val className: String? = "android.widget.TextView",
        override val text: String? = null,
        override val label: String? = null,
        override val hint: String? = null,
        override val editable: Boolean = false,
        override val password: Boolean = false,
        override val enabled: Boolean = true,
        override val focused: Boolean = false,
        override val checked: Boolean = false,
        override val visible: Boolean = true,
        override val bounds: IntArray = intArrayOf(0, 0, 100, 50),
        private val kids: List<Fake> = emptyList(),
    ) : UiTree.Source {
        override val childCount get() = kids.size
        override fun child(index: Int): UiTree.Source? = kids.getOrNull(index)
    }

    @Test
    fun widgetClassesBecomePlainRoles() {
        assertEquals("button", UiTree.role("android.widget.Button"))
        assertEquals("edit", UiTree.role("android.widget.EditText"))
        assertEquals("checkbox", UiTree.role("android.widget.Switch"))
        assertEquals("list", UiTree.role("androidx.recyclerview.widget.RecyclerView"))
        assertEquals("group", UiTree.role("android.widget.LinearLayout"))
        assertEquals("unknown", UiTree.role("com.example.Custom"))
        assertEquals("unknown", UiTree.role(null))
    }

    @Test
    fun anEditableFieldIsNamedByItsLabelNeverByWhatWasTyped() {
        val typed = Fake(className = "android.widget.EditText", editable = true, text = "my secret note", hint = "Note")
        assertEquals("Note", UiTree.name(typed))
        val labelled = Fake(className = "android.widget.EditText", editable = true, text = "my secret note", label = "Notes field")
        assertEquals("Notes field", UiTree.name(labelled))
        val bare = Fake(className = "android.widget.EditText", editable = true, text = "my secret note")
        assertNull(UiTree.name(bare))
        // A plain label or button is named by its text.
        assertEquals("Save", UiTree.name(Fake(className = "android.widget.Button", text = "Save")))
        assertEquals("Close", UiTree.name(Fake(className = "android.widget.ImageButton", label = "Close", text = "x")))
    }

    @Test
    fun aPasswordFieldKeepsItsRoleAndNoName() {
        val raw = UiTree.build(Fake(className = "android.widget.EditText", editable = true, password = true, text = "hunter2", label = "Password", hint = "Enter password"))
        assertEquals("password", raw.role)
        assertTrue(raw.protected)
        assertNull(raw.name)
    }

    @Test
    fun statesAndBoundsAreReported() {
        val raw = UiTree.build(Fake(enabled = false, focused = true, checked = true, visible = false, bounds = intArrayOf(10, 20, 110, 70)))
        assertEquals(listOf("disabled", "focused", "checked", "offscreen"), raw.states)
        assertEquals(listOf(10, 20, 110, 70), raw.bounds.toList())
        assertFalse(raw.protected)
    }

    @Test
    fun aLongNameIsCut() {
        assertEquals(UiTree.MAX_NAME, UiTree.name(Fake(text = "n".repeat(900)))!!.length)
    }

    @Test
    fun depthAndNodeLimitsHold() {
        var deep = Fake()
        repeat(UiTree.MAX_DEPTH + 6) { deep = Fake(kids = listOf(deep)) }
        fun count(raw: UiTree.Raw): Int = 1 + raw.children.sumOf { count(it) }
        assertEquals(UiTree.MAX_DEPTH + 1, count(UiTree.build(deep)))
        val wide = Fake(kids = List(2000) { Fake() })
        assertEquals(UiTree.MAX_NODES, count(UiTree.build(wide)))
    }
}

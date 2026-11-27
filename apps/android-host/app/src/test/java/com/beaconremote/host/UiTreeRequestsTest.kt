package com.beaconremote.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** What the phone does with one message on the semantic-target channel (ADR 0064), checked without Android. */
class UiTreeRequestsTest {
    private val id = "0f8fad5b-d9cb-469f-a165-70867728950e"
    private val request = """{"type":"ui-tree-request","id":"$id"}"""

    @Test
    fun withoutApprovalEveryRequestIsDeniedAndNothingIsRead() {
        val decision = UiTreeRequests.decide(request, allowed = false, lastReadAt = null, now = 0)
        assertEquals(UiTreeRequests.Decision.Reply(UiTreeRequests.refusal(id, "denied")), decision)
        // A denied request never starts the one-a-second clock, so approval is not delayed by earlier tries.
        assertEquals(
            UiTreeRequests.Decision.Read(id),
            UiTreeRequests.decide(request, allowed = true, lastReadAt = null, now = 5),
        )
    }

    @Test
    fun anApprovedRequestReadsOnceASecond() {
        assertEquals(UiTreeRequests.Decision.Read(id), UiTreeRequests.decide(request, true, null, 10_000))
        assertEquals(
            UiTreeRequests.Decision.Reply(UiTreeRequests.refusal(id, "busy")),
            UiTreeRequests.decide(request, true, 10_000, 10_500),
        )
        assertEquals(
            UiTreeRequests.Decision.Read(id),
            UiTreeRequests.decide(request, true, 10_000, 10_000 + UiTreeRequests.MIN_GAP_MS),
        )
    }

    @Test
    fun theIdMayComeFirstAndSpacesAreFine() {
        val reordered = """ { "id" : "$id" , "type" : "ui-tree-request" } """
        assertEquals(UiTreeRequests.Decision.Read(id), UiTreeRequests.decide(reordered, true, null, 0))
    }

    @Test
    fun anythingButAPlainRequestEndsTheChannel() {
        val long = """{"type":"ui-tree-request","id":"$id","pad":"${"x".repeat(300)}"}"""
        for (bad in listOf(
            "",
            "not json",
            "[]",
            """{"type":"ui-tree-request"}""",
            """{"type":"ui-tree-request","id":"nope"}""",
            """{"type":"ui-tree-request","id":"$id","selector":"password"}""",
            """{"type":"clipboard","id":"$id"}""",
            """{"type":"ui-tree-request","id":"$id\"}""",
            long,
        )) {
            assertEquals(bad, UiTreeRequests.Decision.Invalid, UiTreeRequests.decide(bad, true, null, 0))
        }
    }

    @Test
    fun aRefusalIsPlainJsonWithNoDetail() {
        val text = UiTreeRequests.refusal(id, "denied")
        assertEquals("""{"type":"ui-tree","id":"$id","ok":false,"reason":"denied"}""", text)
        assertTrue(text.contains(id))
        assertFalse(text.contains("name"))
    }
}

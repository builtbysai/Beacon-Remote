package com.beaconremote.host

import org.junit.Assert.*
import org.junit.Test

class FilePermissionRequestTest {
    @Test fun approvalBelongsToOneLivePromptAndPeer() {
        val requests = FilePermissionRequest()
        val first = FilePermissionPrompt("session", "first", 0, 30_000)
        assertFalse(requests.allowed(0))
        assertTrue(requests.begin(first, 10))
        assertNull(requests.respond(first.id, 1, true, 12))
        assertNull(requests.respond("old", 0, true, 12))
        assertNull(requests.respond(first.id, 0, true, 30_010))
        assertEquals(first, requests.cancelIfUnavailable(30_010, true))
        assertFalse(requests.allowed(0))

        val second = first.copy(id = "second")
        assertTrue(requests.begin(second, 30_011))
        assertTrue(requests.cancel(second.id, 0))
        assertNull(requests.respond(second.id, 0, true, 30_012))
        val third = first.copy(id = "third")
        assertTrue(requests.begin(third, 30_012))
        assertFalse(requests.commit(third.id, 0, 30_013))
        assertEquals(third, requests.respond(third.id, 0, true, 30_013))
        assertFalse(requests.allowed(0))
        assertFalse(requests.commit(second.id, 0, 30_014))
        assertTrue(requests.commit(third.id, 0, 30_014))
        assertTrue(requests.allowed(0))
        assertFalse(requests.allowed(1))
        requests.detach()
        assertFalse(requests.allowed(0))
    }
}

package com.beaconremote.host

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class AccessIntentFenceTest {
    private val original = AccessBinding("https://example.test", "original")
    @Test fun lateEnableCannotUndoLocalDisable() {
        val fence = AccessIntentFence()
        val ticket = fence.begin(original)
        val response = CountDownLatch(1)
        val done = CountDownLatch(1)
        val enabled = AtomicBoolean(false)
        val applied = AtomicBoolean(true)
        thread {
            check(response.await(2, TimeUnit.SECONDS))
            applied.set(fence.apply(ticket, original) { enabled.set(true) })
            done.countDown()
        }
        fence.invalidate { enabled.set(false) }
        response.countDown()
        assertTrue(done.await(2, TimeUnit.SECONDS))
        assertFalse(applied.get())
        assertFalse(enabled.get())
    }
    @Test fun replacementPairingAndSupersededRequestsRejectOldResults() {
        val fence = AccessIntentFence()
        val first = fence.begin(original)
        assertFalse(fence.apply(first, original.copy(machineId = "replacement")) { fail("Old result wrote the replacement") })
        val second = fence.begin(original)
        fence.finish(first)
        assertTrue(fence.pending(original))
        assertFalse(fence.apply(first, original) { fail("Superseded result wrote") })
        assertTrue(fence.apply(second, original) {})
        assertFalse(fence.pending(original))
        assertFalse(fence.apply(second, original) { fail("Result applied twice") })
    }
}

package com.beaconremote.host

import org.junit.Assert.*
import org.junit.Test

class ConsentRequestDeliveryTest {
    @Test fun idlePollsAndRedeliveryDoNotReopenTheCaptureDialog() {
        val delivery = ConsentRequestDelivery()
        val request = "9b499a4e-c327-488c-a947-4f64d0a19425"
        assertTrue(delivery.claim(request, sharing = false))
        // The backend withholds the acknowledged pending request in idle polls.
        repeat(3) {
            assertFalse(delivery.claim(null, sharing = false))
            assertEquals(request, delivery.handled)
        }
        assertFalse(delivery.claim(request, sharing = false))
        assertEquals(request, delivery.handled)
    }

    @Test fun aNewRequestIsNotLostWhileThePreviousCaptureIsStopping() {
        val delivery = ConsentRequestDelivery()
        assertTrue(delivery.claim("previous", sharing = false))
        assertFalse(delivery.claim("next", sharing = true))
        assertEquals("previous", delivery.handled)
        assertTrue(delivery.claim("next", sharing = false))
        assertEquals("next", delivery.handled)
        assertFalse(delivery.claim("next", sharing = false))
        // A new availability run can deliver a still-pending request afresh.
        assertTrue(ConsentRequestDelivery().claim("next", sharing = false))
    }
}

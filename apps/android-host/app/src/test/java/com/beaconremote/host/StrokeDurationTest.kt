package com.beaconremote.host

import org.junit.Assert.assertEquals
import org.junit.Test

class StrokeDurationTest {
    @Test
    fun aLateArrivingTapIsStillAShortTap() {
        assertEquals(50, RemoteControl.strokeDuration(false, 5))
        assertEquals(50, RemoteControl.strokeDuration(false, 450))
    }

    @Test
    fun aDeliberateHoldKeepsItsLength() {
        assertEquals(800, RemoteControl.strokeDuration(false, 800))
        assertEquals(2000, RemoteControl.strokeDuration(false, 9000))
    }

    @Test
    fun aSwipeKeepsItsSpeedWithinLimits() {
        assertEquals(80, RemoteControl.strokeDuration(true, 10))
        assertEquals(300, RemoteControl.strokeDuration(true, 300))
    }
}

package com.beaconremote.host

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ViewerConnectionTest {
    @Test fun detachedAndReplacedPeersCannotReenableSharing() {
        val viewer = ViewerConnection()
        assertTrue(viewer.owns(0))
        assertFalse(viewer.connected(0))
        assertTrue(viewer.connectionChanged(0, true))
        assertTrue(viewer.connected(0))

        viewer.detach()
        assertFalse(viewer.owns(0))
        assertFalse(viewer.connectionChanged(0, true))
        assertFalse(viewer.connected(0))
        assertFalse(viewer.resume(0))

        assertTrue(viewer.resume(1))
        assertFalse(viewer.connected(1))
        assertFalse(viewer.connectionChanged(0, true))
        assertFalse(viewer.connected(1))
        assertTrue(viewer.connectionChanged(1, true))
        assertTrue(viewer.connected(1))
        assertFalse(viewer.resume(1))
        assertFalse(viewer.connected(0))

        assertTrue(viewer.connectionChanged(1, false))
        assertFalse(viewer.connected(1))
        assertTrue(viewer.connectionChanged(1, true))
        assertTrue(viewer.connected(1))
    }
}

package com.beaconremote.host

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UnattendedAccessTest {
    @Test fun standingPermissionNeverExtendsToSupportOrMissingLocalPermission() {
        assertTrue(UnattendedAccess.accepts(local = true, policy = true, helper = false, ready = true))
        assertFalse(UnattendedAccess.accepts(local = false, policy = true, helper = false, ready = true))
        assertFalse(UnattendedAccess.accepts(local = true, policy = false, helper = false, ready = true))
        assertFalse(UnattendedAccess.accepts(local = true, policy = true, helper = true, ready = true))
        assertFalse(UnattendedAccess.accepts(local = true, policy = true, helper = false, ready = false))
    }
}

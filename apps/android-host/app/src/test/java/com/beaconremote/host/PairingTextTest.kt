package com.beaconremote.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PairingTextTest {
    @Test
    fun readsAWholePairingLink() {
        val parsed = PairingText.parse("beaconremote://pair?code=a-b_C9xyz12&server=https%3A%2F%2Fremote.example.com")
        assertEquals("a-b_C9xyz12", parsed?.code)
        assertEquals("https://remote.example.com", parsed?.server)
    }

    @Test
    fun readsABareCodeAndIgnoresSurroundingSpace() {
        assertEquals(PairingText.Parsed("Abcd1234-_Zz", null), PairingText.parse("  Abcd1234-_Zz \n"))
    }

    @Test
    fun refusesAnythingElse() {
        assertNull(PairingText.parse(null))
        assertNull(PairingText.parse(""))
        assertNull(PairingText.parse("hello world"))
        assertNull(PairingText.parse("short"))
        assertNull(PairingText.parse("https://evil.example/pair?code=Abcd1234Zz"))
        assertNull(PairingText.parse("beaconremote://pair?server=https%3A%2F%2Fx.example"))
        assertNull(PairingText.parse("beaconremote://pair?code=" + "x".repeat(40)))
        assertNull(PairingText.parse("x".repeat(33)))
    }
}

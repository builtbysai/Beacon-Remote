package com.beaconremote.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    // ---- The one pairing contract (review R09) ----

    private val valid: (String) -> String? = { Api.validServer(it) }

    @Test
    fun everySourceOnlyFillsTheFormAndAsksForPair() {
        val parsed = PairingText.parse("beaconremote://pair?code=Abcd1234Zz&server=https%3A%2F%2Fremote.example.com")!!
        val results = PairingText.Source.values().map { PairingText.prefill(parsed, it, PairingText.DEFAULT_SERVER, valid) }
        // Scan, link and paste agree on the code, the server and the next step; only the first words name the source.
        assertEquals(1, results.map { it.code to it.server }.toSet().size)
        assertEquals("https://remote.example.com", results.first().server)
        for (result in results) assertTrue(result.notice, result.notice.endsWith("Check the details, then tap Pair device."))
    }

    @Test
    fun aBareCodeKeepsTheServerAlreadyInTheForm() {
        val result = PairingText.prefill(PairingText.Parsed("Abcd1234Zz", null), PairingText.Source.CLIPBOARD, "https://mine.example.org", valid)
        assertEquals("https://mine.example.org", result.server)
        assertEquals("Code pasted. Check the details, then tap Pair device.", result.notice)
    }

    @Test
    fun aServerTheFormCannotUseIsNeverUsedAndTheNoticeSaysSo() {
        for (bad in listOf("http://evil.example", "https://evil.example/path", "javascript:alert(1)", "https://user:pw@evil.example")) {
            val result = PairingText.prefill(PairingText.Parsed("Abcd1234Zz", bad), PairingText.Source.LINK, PairingText.DEFAULT_SERVER, valid)
            assertEquals(bad, PairingText.DEFAULT_SERVER, result.server)
            assertTrue(result.notice, result.notice.contains("not valid, so it was not used"))
        }
    }

    @Test
    fun onlyAnUnusualServerIsNamedOnScreen() {
        assertNull(PairingText.serverNote(PairingText.DEFAULT_SERVER))
        assertNull(PairingText.serverNote(PairingText.DEFAULT_SERVER + "/"))
        assertEquals(
            "This pairs with remote.example.com, not the usual Beacon Remote service. Pair only if you trust it.",
            PairingText.serverNote("https://remote.example.com"),
        )
        assertTrue(PairingText.serverNote("http://10.0.2.2:3012")!!.contains("10.0.2.2:3012"))
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

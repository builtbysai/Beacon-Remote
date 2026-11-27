package com.beaconremote.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Which server addresses the app accepts (the pairing screen's origin rule). */
class ApiServerTest {
    @Test
    fun anHttpsOriginIsAcceptedWithoutATrailingSlash() {
        assertEquals("https://remote.example.com", Api.validServer(" https://remote.example.com/ "))
    }

    @Test
    fun plainHttpIsAcceptedOnlyForTheEmulatorRouteAndNeverForARealHost() {
        assertEquals("http://10.0.2.2:3010", Api.validServer("http://10.0.2.2:3010"))
        assertNull(Api.validServer("http://remote.example.com"))
        assertNull(Api.validServer("http://192.168.0.5:3010"))
        assertNull(Api.validServer("ftp://remote.example.com"))
    }

    @Test
    fun loopbackIsAcceptedOnlyByADebugBuild() {
        val expected = if (BuildConfig.DEBUG) "http://127.0.0.1:3012" else null
        assertEquals(expected, Api.validServer("http://127.0.0.1:3012"))
        assertEquals(if (BuildConfig.DEBUG) "http://localhost:3012" else null, Api.validServer("http://localhost:3012"))
    }

    @Test
    fun anAddressWithAPathAccountOrQueryIsRefused() {
        assertNull(Api.validServer("https://remote.example.com/app"))
        assertNull(Api.validServer("https://user:pass@remote.example.com"))
        assertNull(Api.validServer("https://remote.example.com?x=1"))
        assertNull(Api.validServer("https://remote.example.com#frag"))
        assertNull(Api.validServer("not a url"))
    }
}

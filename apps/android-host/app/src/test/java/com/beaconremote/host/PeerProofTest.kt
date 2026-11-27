package com.beaconremote.host

import com.google.crypto.tink.subtle.Ed25519Sign
import com.google.crypto.tink.subtle.Ed25519Verify
import java.io.File
import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotEquals
import org.junit.Test

/** The phone's proof must be byte-identical to what the Rust agent and the web viewer build and check (ADR 0061). */
class PeerProofTest {
    private val vector = File("../../../packages/protocol/test-vectors/peer-chain-v1.json").readText()

    private fun text(block: String, key: String): String =
        Regex("\"$key\":\\s*\"([^\"]*)\"").find(block)!!.groupValues[1]

    private fun number(block: String, key: String): Long =
        Regex("\"$key\":\\s*(\\d+)").find(block)!!.groupValues[1].toLong()

    private fun hex(value: String): ByteArray =
        ByteArray(value.length / 2) { value.substring(it * 2, it * 2 + 2).toInt(16).toByte() }

    private val machineSeed = hex(text(vector, "machineSeedHex"))
    private val sessionSeed = hex(text(vector, "sessionSeedHex"))
    private val delegationBlock = vector.substringAfter("\"delegation\"").substringBefore("\"delegationText\"")
    private val statementBlock = vector.substringAfter("\"statement\"")
    private val sdp = text(vector, "sdp").replace("\\r\\n", "\r\n")

    @Test
    fun theBytesAndSignaturesMatchTheSharedVector() {
        val sessionId = text(delegationBlock, "sessionId")
        val machine = Ed25519Sign(machineSeed)
        val session =
            PeerProof.Session(
                sessionId,
                { bytes -> machine.sign(bytes) },
                number(delegationBlock, "expiresAtMs"),
                sessionSeed,
            )
        val nonce = Base64.getUrlDecoder().decode(text(statementBlock, "nonce"))
        val now = number(statementBlock, "expiresAtMs") - PeerProof.STATEMENT_LIFETIME_MS
        val proof = session.proof(number(statementBlock, "generation"), sdp, nonce, now)!!
        assertEquals(text(delegationBlock, "sessionKey"), proof.sessionKey)
        assertEquals(text(delegationBlock, "signature"), proof.delegationSignature)
        assertEquals(text(statementBlock, "nonce"), proof.nonce)
        assertEquals(number(statementBlock, "expiresAtMs"), proof.statementExpiresAtMs)
        assertEquals(text(statementBlock, "signature"), proof.statementSignature)
        assertEquals(text(vector, "delegationText").replace("\\n", "\n"), PeerProof.delegationText(sessionId, proof.sessionKey, proof.delegationExpiresAtMs))
        assertEquals(text(vector, "sdpFingerprint"), PeerProof.sdpFingerprint(sdp))
    }

    @Test
    fun theProofVerifiesDownTheChainWithThePinnedKey() {
        val machine = Ed25519Sign.KeyPair.newKeyPairFromSeed(machineSeed)
        val sessionId = "0f8fad5b-d9cb-469f-a165-70867728950e"
        val signer = Ed25519Sign(machineSeed)
        val end = 2_000_000_000_000L
        val session = PeerProof.Session(sessionId, { signer.sign(it) }, end)
        val offer = "v=0\r\na=fingerprint:sha-256 ${List(32) { "AB" }.joinToString(":")}\r\n"
        val proof = session.proof(2, offer, PeerProof.newNonce(), 1_999_999_000_000L)!!
        val decoder = Base64.getUrlDecoder()
        Ed25519Verify(machine.publicKey).verify(
            decoder.decode(proof.delegationSignature),
            PeerProof.delegationText(sessionId, proof.sessionKey, proof.delegationExpiresAtMs).toByteArray(),
        )
        Ed25519Verify(decoder.decode(proof.sessionKey)).verify(
            decoder.decode(proof.statementSignature),
            PeerProof.statementText(
                sessionId,
                2,
                PeerProof.sdpFingerprint(offer)!!,
                proof.nonce,
                proof.statementExpiresAtMs,
            ).toByteArray(),
        )
        assertEquals(22, proof.nonce.length)
        assertEquals(86, proof.statementSignature.length)
        // The identity key signed only the delegation: a fresh session gets a different key.
        val other = PeerProof.Session(sessionId, { signer.sign(it) }, end).proof(2, offer, PeerProof.newNonce(), 1L)!!
        assertNotEquals(proof.sessionKey, other.sessionKey)
    }

    @Test
    fun anSdpWithoutOneFingerprintCannotBeVouchedFor() {
        assertEquals("sha-256 AA:BB", PeerProof.sdpFingerprint("a=fingerprint:sha-256 aa:bb\r\n"))
        assertNull(PeerProof.sdpFingerprint("v=0\r\n"))
        assertNull(PeerProof.sdpFingerprint("a=fingerprint:sha-256 AA:BB\r\na=fingerprint:sha-256 AA:CC\r\n"))
        assertNull(PeerProof.sdpFingerprint("a=fingerprint:sha-1 AA:BB\r\n"))
        val session = PeerProof.Session("0f8fad5b-d9cb-469f-a165-70867728950e", { ByteArray(64) }, 1L)
        assertNull(session.proof(1, "v=0\r\n", PeerProof.newNonce(), 1L))
        assertNotNull(session.proof(1, "a=fingerprint:sha-256 AA:BB\r\n", PeerProof.newNonce(), 1L))
    }
}

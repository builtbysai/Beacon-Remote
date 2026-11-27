package com.beaconremote.host

import com.google.crypto.tink.subtle.Ed25519Sign
import java.security.SecureRandom
import java.util.Base64

/**
 * Peer authentication (ADR 0061): proof, sent beside each offer, that it was made by this phone. The phone signs a
 * delegation of a key it mints for the session with its identity key, then signs a statement over the DTLS fingerprint in
 * the offer with that session key. The viewer checks the chain against the key it pinned for this phone. The bytes
 * are the same ones the TypeScript and Rust sides build; the shared vector keeps them identical.
 */
object PeerProof {
    private val encoder = Base64.getUrlEncoder().withoutPadding()
    private val fingerprintLine = Regex("^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)\\s*$")

    /** A statement made for one offer stays good for this long. */
    const val STATEMENT_LIFETIME_MS = 30_000L

    fun url(bytes: ByteArray): String = encoder.encodeToString(bytes)

    /** The DTLS fingerprint in an SDP, normalised; null if there is none or the media sections disagree. */
    fun sdpFingerprint(sdp: String): String? {
        val found = LinkedHashSet<String>()
        for (line in sdp.split("\r\n", "\n")) {
            if (!line.startsWith("a=fingerprint:")) continue
            val match = fingerprintLine.matchEntire(line) ?: return null
            found.add("sha-256 " + match.groupValues[1].uppercase())
        }
        return if (found.size == 1) found.first() else null
    }

    fun delegationText(sessionId: String, sessionKey: String, expiresAtMs: Long): String =
        "beacon-peer-delegation-v1\nsession:$sessionId\nkey:$sessionKey\nexpires:$expiresAtMs"

    fun statementText(
        sessionId: String,
        generation: Long,
        fingerprint: String,
        nonce: String,
        expiresAtMs: Long,
    ): String =
        "beacon-peer-v1\nsession:$sessionId\ngeneration:$generation\nrole:host\nfingerprint:$fingerprint\nnonce:$nonce\nexpires:$expiresAtMs"

    data class Proof(
        val sessionId: String,
        val sessionKey: String,
        val delegationExpiresAtMs: Long,
        val delegationSignature: String,
        val nonce: String,
        val statementExpiresAtMs: Long,
        val statementSignature: String,
    )

    /**
     * One session's keys: a key minted for this session and the identity key's signature delegating it. The identity key
     * only ever signs the delegation, once; the session key signs every offer.
     */
    class Session(
        private val sessionId: String,
        sign: (ByteArray) -> ByteArray,
        private val expiresAtMs: Long,
        private val seed: ByteArray = Ed25519Sign.KeyPair.newKeyPair().privateKey,
    ) {
        private val publicKey: String =
            url(Ed25519Sign.KeyPair.newKeyPairFromSeed(seed).publicKey)
        private val delegationSignature: String =
            url(sign(delegationText(sessionId, publicKey, expiresAtMs).toByteArray(Charsets.UTF_8)))

        /** The proof for this offer, or null when the SDP has no single fingerprint to vouch for. */
        fun proof(
            generation: Long,
            sdp: String,
            nonce: ByteArray,
            nowMs: Long,
        ): Proof? {
            val fingerprint = sdpFingerprint(sdp) ?: return null
            val nonceText = url(nonce)
            val statementEnd = nowMs + STATEMENT_LIFETIME_MS
            val signature =
                Ed25519Sign(seed).sign(
                    statementText(sessionId, generation, fingerprint, nonceText, statementEnd)
                        .toByteArray(Charsets.UTF_8),
                )
            return Proof(
                sessionId,
                publicKey,
                expiresAtMs,
                delegationSignature,
                nonceText,
                statementEnd,
                url(signature),
            )
        }
    }

    fun newNonce(): ByteArray = ByteArray(16).also { SecureRandom().nextBytes(it) }
}

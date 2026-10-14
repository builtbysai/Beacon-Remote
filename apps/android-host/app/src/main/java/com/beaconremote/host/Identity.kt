package com.beaconremote.host

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.google.crypto.tink.subtle.Ed25519Sign
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * This phone's identity: an Ed25519 key pair whose private half never leaves the device unprotected.
 * The 32-byte seed is sealed with an Android Keystore AES key (hardware backed where available) and
 * stored next to the pairing details. Presence and policy requests are signed with it, exactly like the
 * Windows host (docs/protocol.md).
 */
class Identity(private val context: Context) {
    private val prefs = context.getSharedPreferences("identity", Context.MODE_PRIVATE)

    var server: String
        get() = prefs.getString("server", "") ?: ""
        private set(value) = prefs.edit().putString("server", value).apply()
    var machineId: String
        get() = prefs.getString("machineId", "") ?: ""
        private set(value) = prefs.edit().putString("machineId", value).apply()
    var name: String
        get() = prefs.getString("name", "") ?: ""
        private set(value) = prefs.edit().putString("name", value).apply()

    /** Whether the person wants this phone reachable; kept across restarts, cleared by Stop being available. */
    var wantsAvailable: Boolean
        get() = prefs.getBoolean("available", false)
        set(value) = prefs.edit().putBoolean("available", value).apply()

    val paired: Boolean get() = machineId.isNotEmpty() && prefs.contains("seed")

    /** A new key pair for pairing. The seed is stored only once the server accepts the enrollment. */
    fun newKey(): Pair<ByteArray, String> {
        val pair = Ed25519Sign.KeyPair.newKeyPair()
        return pair.privateKey to Base64.encodeToString(pair.publicKey, Base64.NO_WRAP)
    }

    fun savePairing(server: String, machineId: String, name: String, seed: ByteArray) {
        prefs.edit().putString("seed", seal(seed)).apply()
        this.server = server
        this.machineId = machineId
        this.name = name
    }

    fun clear() {
        prefs.edit().clear().apply()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }

    /** Base64 Ed25519 signature of the exact canonical message. */
    fun sign(message: String): String {
        val seed = unseal(prefs.getString("seed", null) ?: error("Not paired"))
        return Base64.encodeToString(Ed25519Sign(seed).sign(message.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return generator.generateKey()
    }

    private fun seal(seed: ByteArray): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val sealed = cipher.doFinal(seed)
        return Base64.encodeToString(cipher.iv + sealed, Base64.NO_WRAP)
    }

    private fun unseal(stored: String): ByteArray {
        val bytes = Base64.decode(stored, Base64.NO_WRAP)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, 12))
        return cipher.doFinal(bytes, 12, bytes.size - 12)
    }

    private companion object {
        const val ALIAS = "beacon-remote-host-identity"
    }
}

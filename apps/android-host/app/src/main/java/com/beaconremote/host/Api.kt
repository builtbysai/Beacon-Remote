package com.beaconremote.host

import java.util.UUID
import java.util.concurrent.TimeUnit
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject

/** A request for this phone's screen, as the server hands it out in a presence reply. */
data class Grant(
    val id: String,
    val token: String,
    val controller: String,
    val capability: String,
    val approval: String?,
    val iceServers: JSONArray,
    val relayOnly: Boolean,
    val reconnectSeconds: Int,
) {
    companion object {
        fun from(json: JSONObject) =
            Grant(
                id = json.getString("id"),
                token = json.getString("token"),
                controller = json.optString("controller", "Someone"),
                capability = json.optString("capability", "desktop:view"),
                approval = json.optString("approval").ifEmpty { null },
                iceServers = json.optJSONArray("iceServers") ?: JSONArray(),
                relayOnly = json.optString("iceTransportPolicy") == "relay",
                reconnectSeconds = json.optInt("reconnectSeconds", 120),
            )
    }
}

class PairingFailed(message: String) : Exception(message)

object Api {
    val http: OkHttpClient =
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .callTimeout(40, TimeUnit.SECONDS)
            .build()
    private val json = "application/json".toMediaType()

    /** An https origin, or the emulator's route to the development computer. Anything else is refused. */
    fun validServer(input: String): String? {
        val trimmed = input.trim().trimEnd('/')
        val url = trimmed.toHttpUrlOrNull() ?: return null
        val local = url.host == "10.0.2.2"
        if (!(url.scheme == "https" || (url.scheme == "http" && local))) return null
        if (url.encodedPath != "" && url.encodedPath != "/") return null
        if (url.query != null || url.fragment != null || url.username.isNotEmpty() || url.password.isNotEmpty()) return null
        return trimmed
    }

    fun enroll(server: String, code: String, name: String, publicKey: String): String {
        val body =
            JSONObject()
                .put("version", 1)
                .put("code", code.trim())
                .put("name", name.trim())
                .put("publicKey", publicKey)
        val request = Request.Builder().url("$server/api/agent/enroll").post(body.toString().toRequestBody(json)).build()
        http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw PairingFailed("The server did not accept that code. It works once and expires after five minutes.")
            return JSONObject(response.body?.string() ?: "{}").getString("machineId")
        }
    }

    /** Signed presence. With wait the server holds the call until someone asks for this phone. */
    fun heartbeat(identity: Identity, wait: Boolean, handled: String?): JSONObject {
        val timestamp = System.currentTimeMillis()
        val nonce = UUID.randomUUID().toString()
        val signature = identity.sign("beacon-remote:heartbeat:v1\n${identity.machineId}\n$timestamp\n$nonce")
        val body =
            JSONObject()
                .put("version", 1)
                .put("machineId", identity.machineId)
                .put("timestamp", timestamp)
                .put("nonce", nonce)
                .put("signature", signature)
        val query = buildString {
            if (wait) append("?wait=1")
            if (handled != null) append(if (isEmpty()) "?" else "&").append("handled=").append(handled)
        }
        val request = Request.Builder().url("${identity.server}/api/agent/heartbeat$query").post(body.toString().toRequestBody(json)).build()
        http.newCall(request).execute().use { response ->
            if (response.code == 401 || response.code == 409) throw Rejected()
            if (!response.isSuccessful) throw java.io.IOException("Presence failed (${response.code})")
            return JSONObject(response.body?.string() ?: "{}")
        }
    }

    class Rejected : Exception("The server no longer accepts this phone")
}

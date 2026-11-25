package com.beaconremote.host

import java.net.URLDecoder

/**
 * What a person might copy in the workspace to pair a phone: the whole pairing link
 * (beaconremote://pair?code=...&server=...) or only the one-use code. This reads either and returns the code and,
 * when the link carries one, the workspace address. It never pairs: the person still taps Pair.
 */
object PairingText {
    data class Parsed(val code: String, val server: String?)

    private val bareCode = Regex("^[A-Za-z0-9_-]{8,32}$")

    fun parse(raw: String?): Parsed? {
        val text = raw?.trim().orEmpty()
        if (text.isEmpty() || text.length > 2048) return null
        if (text.startsWith("beaconremote://pair", ignoreCase = true)) {
            val query = text.substringAfter('?', "")
            val parts = query.split('&').mapNotNull {
                val key = it.substringBefore('=', "")
                if (key.isEmpty() || !it.contains('=')) null else key to decode(it.substringAfter('='))
            }.toMap()
            val code = parts["code"]?.takeIf { it.isNotEmpty() && it.length <= 32 } ?: return null
            return Parsed(code, parts["server"]?.takeIf { it.isNotEmpty() })
        }
        return if (bareCode.matches(text)) Parsed(text, null) else null
    }

    private fun decode(value: String) = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
}

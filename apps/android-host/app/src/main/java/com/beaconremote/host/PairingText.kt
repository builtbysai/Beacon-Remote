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

    /** The workspace a phone pairs with unless a link or the person names another one. */
    const val DEFAULT_SERVER = "https://remote.builtbysai.com"

    /** Where a pairing code came from. Every source follows the same contract (review R09). */
    enum class Source(val done: String) {
        SCAN("Code scanned."),
        LINK("Pairing link opened."),
        CLIPBOARD("Code pasted."),
    }

    /** What the pairing form shows after a code arrives: the code, the server to use, and what to tell the person. */
    data class Prefill(val code: String, val server: String, val notice: String)

    /**
     * The one pairing contract: a scanned QR code, a pairing link and a pasted code all only fill the form; nothing pairs
     * until the person taps Pair device. A server the link names replaces [currentServer] only when [valid] accepts it;
     * one it refuses is never used, and the person is told. A bare code keeps the server already in the form.
     */
    fun prefill(parsed: Parsed, source: Source, currentServer: String, valid: (String) -> String?): Prefill {
        val named = parsed.server
        val accepted = named?.let(valid)
        val server = accepted ?: currentServer
        val notice = buildString {
            append(source.done)
            if (named != null && accepted == null) append(" Its server address is not valid, so it was not used.")
            append(" Check the details, then tap Pair device.")
        }
        return Prefill(parsed.code, server, notice)
    }

    /**
     * A plain sentence naming a server that is not the usual one, so a person sees where they are about to pair before
     * tapping Pair; null for the default server, which needs no URL on screen.
     */
    fun serverNote(server: String): String? {
        val trimmed = server.trim().trimEnd('/')
        if (trimmed.isEmpty() || trimmed.equals(DEFAULT_SERVER, ignoreCase = true)) return null
        val host = runCatching { java.net.URI(trimmed) }.getOrNull()?.let { uri ->
            uri.host?.let { if (uri.port != -1) "$it:${uri.port}" else it }
        } ?: trimmed
        return "This pairs with $host, not the usual Beacon Remote service. Pair only if you trust it."
    }

    private fun decode(value: String) = runCatching { URLDecoder.decode(value, "UTF-8") }.getOrDefault(value)
}

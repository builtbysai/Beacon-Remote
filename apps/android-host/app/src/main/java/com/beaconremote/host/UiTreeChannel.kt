package com.beaconremote.host

import android.util.Log
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.Executors
import org.json.JSONObject
import org.webrtc.DataChannel

/**
 * The phone's side of the `beacon-ui-tree-v1` channel (ADR 0064). The viewer sends `{"type":"ui-tree-request","id":<uuid>}`
 * and gets back the bounded interface tree of the active window or a refusal. Until the person on this phone approves the
 * "Screen structure" permission for this connection every request is answered `denied`; reads are limited to one a second.
 * It only reads, never what was typed and never a password field's name (see [UiTree]). Contents are never logged.
 */
internal object UiTreeRequests {
    const val MAX_MESSAGE = 256
    const val MIN_GAP_MS = 1000L

    sealed class Decision {
        /** Answer now (a refusal). */
        data class Reply(val text: String) : Decision()

        /** Read the window, then answer this id with the tree. */
        data class Read(val id: String) : Decision()

        /** Not a valid request: the channel ends. */
        object Invalid : Decision()
    }

    private val UUID_TEXT = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    private val TYPE_FIRST = Regex("""^\s*\{\s*"type"\s*:\s*"ui-tree-request"\s*,\s*"id"\s*:\s*"($UUID_TEXT)"\s*\}\s*$""")
    private val ID_FIRST = Regex("""^\s*\{\s*"id"\s*:\s*"($UUID_TEXT)"\s*,\s*"type"\s*:\s*"ui-tree-request"\s*\}\s*$""")

    /** An id that is a plain UUID may be written into a reply as it is. */
    private fun requestId(message: String): String? {
        if (message.length > MAX_MESSAGE) return null
        val id = (TYPE_FIRST.matchEntire(message) ?: ID_FIRST.matchEntire(message))?.groupValues?.get(1) ?: return null
        return runCatching { UUID.fromString(id).toString() }.getOrNull()?.takeIf { it.equals(id, ignoreCase = true) }
    }

    fun refusal(id: String, reason: String) = """{"type":"ui-tree","id":"$id","ok":false,"reason":"$reason"}"""

    /** Decides one message before anything is read. [allowed] is the person's approval and that sharing is live. */
    fun decide(message: String, allowed: Boolean, lastReadAt: Long?, now: Long): Decision {
        val id = requestId(message) ?: return Decision.Invalid
        if (!allowed) return Decision.Reply(refusal(id, "denied"))
        if (lastReadAt != null && now - lastReadAt < MIN_GAP_MS) return Decision.Reply(refusal(id, "busy"))
        return Decision.Read(id)
    }
}

internal class UiTreeChannel(
    private val channel: DataChannel,
    /** The person's approval for this connection, and that sharing is live, unpaused and the phone unlocked. */
    private val allowed: () -> Boolean,
    private val clock: () -> Long = { android.os.SystemClock.elapsedRealtime() },
) : DataChannel.Observer {
    private var lastReadAt: Long? = null
    private val reader = Executors.newSingleThreadExecutor()

    fun start() = channel.registerObserver(this)

    fun close() {
        runCatching { channel.unregisterObserver() }
        reader.shutdownNow()
    }

    fun isOpen() = channel.state() == DataChannel.State.OPEN

    override fun onBufferedAmountChange(previousAmount: Long) {}

    override fun onStateChange() {}

    override fun onMessage(buffer: DataChannel.Buffer) {
        if (buffer.binary) return close()
        val bytes = ByteArray(minOf(buffer.data.remaining(), UiTreeRequests.MAX_MESSAGE + 1))
        buffer.data.duplicate().get(bytes)
        val now = clock()
        when (val decision = UiTreeRequests.decide(String(bytes), allowed(), lastReadAt, now)) {
            is UiTreeRequests.Decision.Invalid -> close()
            is UiTreeRequests.Decision.Reply -> send(decision.text)
            is UiTreeRequests.Decision.Read -> {
                lastReadAt = now
                // Reading talks to other apps, so it never runs on the channel's own thread.
                reader.execute {
                    val root = ControlService.instance?.rootInActiveWindow
                    val read = try {
                        runCatching { UiTree.read(root) }.getOrNull()
                    } finally {
                        @Suppress("DEPRECATION")
                        if (android.os.Build.VERSION.SDK_INT < 33) root?.recycle()
                    }
                    // Approval may have ended while reading; a tree is not sent after that.
                    if (!allowed()) return@execute send(UiTreeRequests.refusal(decision.id, "denied"))
                    send(
                        if (read == null) UiTreeRequests.refusal(decision.id, "unavailable")
                        else JSONObject().put("type", "ui-tree").put("id", decision.id).put("ok", true)
                            .put("truncated", read.truncated).put("tree", read.tree)
                            .apply { displayJson()?.let { put("display", it) } }.toString(),
                    )
                }
            }
        }
    }

    /** The phone's whole screen, in the same coordinates as the tree's boxes (they start at the top left of the screen). */
    private fun displayJson(): JSONObject? {
        val service = ControlService.instance ?: return null
        val windows = service.getSystemService(android.view.WindowManager::class.java) ?: return null
        val (width, height) =
            if (android.os.Build.VERSION.SDK_INT >= 30) windows.currentWindowMetrics.bounds.let { it.width() to it.height() }
            else android.util.DisplayMetrics().also {
                @Suppress("DEPRECATION")
                windows.defaultDisplay.getRealMetrics(it)
            }.let { it.widthPixels to it.heightPixels }
        return if (width > 0 && height > 0) JSONObject().put("x", 0).put("y", 0).put("width", width).put("height", height) else null
    }

    private fun send(text: String) {
        runCatching { channel.send(DataChannel.Buffer(ByteBuffer.wrap(text.toByteArray()), false)) }
            .onFailure { Log.w("BeaconHost", "UI tree reply could not be sent") }
    }
}

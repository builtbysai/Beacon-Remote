package com.beaconremote.host

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.util.Log
import java.io.OutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import org.json.JSONObject
import org.webrtc.DataChannel

/**
 * Receiving files from the helper on the `beacon-files-v1` channel (ADR 0031, as the Windows host does it). The
 * channel exists only when the person ticked "Also allow receiving files" for this session. A file lands in
 * Downloads/Beacon Remote, never replaces anything (Android adds " (1)" to a repeated name), appears only once its
 * length and SHA-256 match, and an unfinished or failed one is deleted. One file at a time; 2 GiB each, 4 GiB a session.
 * Sending files from the phone to the helper is not supported.
 */
class FileReceiver(
    private val context: Context,
    private val channel: DataChannel,
    /** False while sharing is paused or the session is over: offers are refused and a file in flight is dropped. */
    private val allowed: () -> Boolean,
) : DataChannel.Observer {
    private val io = Executors.newSingleThreadExecutor()
    private var current: Incoming? = null
    private var total = 0L

    private class Incoming(
        val id: Int,
        val uri: Uri,
        val stream: OutputStream,
        val size: Long,
        val name: String,
    ) {
        var written = 0L
        val digest: MessageDigest = MessageDigest.getInstance("SHA-256")
    }

    fun start() = channel.registerObserver(this)

    fun stop() {
        post { discard() }
        runCatching { channel.unregisterObserver() }
        runCatching { channel.close() }
        io.shutdown()
    }

    private fun post(block: () -> Unit) {
        try {
            io.execute { runCatching(block).onFailure { Log.w(TAG, "File transfer step failed", it) } }
        } catch (_: RejectedExecutionException) {
        }
    }

    private fun send(message: JSONObject) {
        channel.send(DataChannel.Buffer(ByteBuffer.wrap(message.toString().toByteArray()), false))
    }

    override fun onBufferedAmountChange(previous: Long) {}

    override fun onStateChange() {
        when (channel.state()) {
            DataChannel.State.OPEN ->
                post {
                    send(JSONObject().put("t", "ready").put("maxFile", MAX_FILE).put("chunk", MAX_CHUNK).put("files", true).put("recording", false))
                }
            DataChannel.State.CLOSED, DataChannel.State.CLOSING -> post { discard() }
            else -> {}
        }
    }

    override fun onMessage(buffer: DataChannel.Buffer) {
        // The buffer is only valid during this call, so copy before the work moves to the file thread.
        val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
        val binary = buffer.binary
        post { if (binary) chunk(bytes) else control(bytes) }
    }

    private fun control(bytes: ByteArray) {
        val body = runCatching { JSONObject(String(bytes)) }.getOrNull() ?: return
        val id = body.optInt("id", -1)
        when (body.optString("t")) {
            "offer" -> offer(id, body.optString("name"), body.optLong("size", 0))
            "end" -> finish(id, body.optString("sha256"))
            "cancel" -> if (current?.id == id) discard()
        }
    }

    private fun refuse(id: Int, reason: String) {
        send(JSONObject().put("t", "reject").put("id", id).put("reason", reason))
    }

    private fun offer(id: Int, proposed: String, size: Long) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return refuse(id, "disk")
        if (!allowed()) return refuse(id, "paused")
        if (current != null) return refuse(id, "busy")
        if (size <= 0 || size > MAX_FILE) return refuse(id, "too-large")
        if (total + size > MAX_SESSION) return refuse(id, "session-full")
        val name = safeName(proposed) ?: return refuse(id, "name")
        val values =
            ContentValues().apply {
                put(MediaStore.Downloads.DISPLAY_NAME, name)
                put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/Beacon Remote")
                put(MediaStore.Downloads.IS_PENDING, 1)
            }
        val uri = context.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: return refuse(id, "disk")
        val stream = context.contentResolver.openOutputStream(uri) ?: return run {
            context.contentResolver.delete(uri, null, null)
            refuse(id, "disk")
        }
        current = Incoming(id, uri, stream, size, name)
        HostState.status = "Receiving $name"
        send(JSONObject().put("t", "accept").put("id", id))
    }

    private fun chunk(message: ByteArray) {
        val incoming = current ?: return
        if (message.size <= 4 || message.size > 4 + MAX_CHUNK) return fail(incoming, "write")
        val id = ByteBuffer.wrap(message, 0, 4).int
        if (id != incoming.id) return
        if (!allowed()) return discard()
        val count = message.size - 4
        if (incoming.written + count > incoming.size) return fail(incoming, "size")
        runCatching {
            incoming.stream.write(message, 4, count)
            incoming.digest.update(message, 4, count)
            incoming.written += count
        }.onFailure { fail(incoming, "write") }
    }

    private fun finish(id: Int, sha256: String) {
        val incoming = current ?: return
        if (incoming.id != id) return
        val digest = incoming.digest.digest().joinToString("") { "%02x".format(it) }
        val intact = incoming.written == incoming.size && digest.equals(sha256, ignoreCase = true)
        if (!intact) return fail(incoming, "incomplete")
        runCatching {
            incoming.stream.flush()
            incoming.stream.close()
            context.contentResolver.update(incoming.uri, ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }, null, null)
        }.onFailure { return fail(incoming, "write") }
        current = null
        total += incoming.size
        HostState.status = "Received ${incoming.name}"
        send(JSONObject().put("t", "done").put("id", id).put("name", incoming.name))
    }

    private fun fail(incoming: Incoming, reason: String) {
        discard()
        HostState.status = "A file did not arrive intact and was discarded"
        send(JSONObject().put("t", "failed").put("id", incoming.id).put("reason", reason))
    }

    /** Drops the file in flight, if any: nothing half-received stays in Downloads. */
    private fun discard() {
        val incoming = current ?: return
        current = null
        runCatching { incoming.stream.close() }
        runCatching { context.contentResolver.delete(incoming.uri, null, null) }
    }

    companion object {
        private const val TAG = "BeaconHost"
        const val MAX_FILE = 2L * 1024 * 1024 * 1024
        const val MAX_SESSION = 4L * 1024 * 1024 * 1024
        const val MAX_CHUNK = 64 * 1024

        /** Saving into Downloads/Beacon Remote through MediaStore needs Android 10. */
        val supported: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

        /** One safe file name component: no separators or reserved characters, no trailing dots or spaces, bounded length. */
        fun safeName(proposed: String): String? {
            val last = proposed.substringAfterLast('/').substringAfterLast('\\')
            val cleaned =
                last.filter { !it.isISOControl() }
                    .map { if ("<>:\"|?*".contains(it)) '_' else it }
                    .joinToString("")
                    .trim(' ', '.')
            if (cleaned.isEmpty()) return null
            val dot = cleaned.lastIndexOf('.')
            val stem = (if (dot > 0) cleaned.substring(0, dot) else cleaned).take(120).trimEnd(' ', '.')
            val extension = if (dot > 0) cleaned.substring(dot).take(16) else ""
            return if (stem.isEmpty()) null else stem + extension
        }
    }
}

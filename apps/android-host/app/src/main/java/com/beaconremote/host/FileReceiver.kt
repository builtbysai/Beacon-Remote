package com.beaconremote.host

import android.content.ContentValues
import android.content.Context
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
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
 * channel advertises readiness only with local permission. A file lands in
 * Downloads/Beacon Remote, never replaces anything (Android adds " (1)" to a repeated name), appears only once its
 * length and SHA-256 match, and an unfinished or failed one is deleted. One file at a time; 2 GiB each, 4 GiB a session.
 * The phone can also offer a file it picked (`send`, even ids, as the Windows host does). It streams only while the
 * viewer has file permission, sharing is live and not paused; a Stop, Pause, cancel or lost channel ends it.
 */
class FileReceiver(
    private val context: Context,
    private val channel: DataChannel,
    private val permitted: () -> Boolean,
    /** False while sharing is paused or the session is over: offers are refused and a file in flight is dropped. */
    private val allowed: () -> Boolean,
) : DataChannel.Observer {
    @Volatile var lastActivity: Long = 0L
        private set
    private val io = Executors.newSingleThreadExecutor()
    private var current: Incoming? = null
    private var total = 0L
    // The phone's own offers use even ids. `abortRequested` is set from the channel thread so a viewer cancel reaches a stream in progress.
    @Volatile private var outgoing: Outgoing? = null
    private var nextOutgoingId = 2

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

    private class Outgoing(val id: Int, val uri: Uri, val name: String, val size: Long) {
        @Volatile var abortRequested = false
    }

    fun start() = channel.registerObserver(this)

    fun isOpen(): Boolean = channel.state() == DataChannel.State.OPEN

    fun publishReady() {
        post {
            if (channel.state() == DataChannel.State.OPEN && permitted())
                send(JSONObject().put("t", "ready").put("maxFile", MAX_FILE).put("chunk", MAX_CHUNK).put("files", true).put("recording", false))
        }
    }

    /** True when the phone could offer a file right now. The sharing window and notification use it. */
    fun canSend(): Boolean = channel.state() == DataChannel.State.OPEN && outgoing == null && current == null

    /**
     * Offers a file the person picked on this phone. [onResult] receives a short reason when nothing is offered.
     * Nothing leaves the phone unless the viewer currently holds file permission and sharing is live and unpaused.
     */
    fun sendFile(uri: Uri, onResult: (String) -> Unit) = post { offerOutgoing(uri, onResult) }

    fun stop() {
        post {
            discard()
            dropOutgoing()
        }
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
            DataChannel.State.OPEN -> publishReady()
            DataChannel.State.CLOSED, DataChannel.State.CLOSING -> post {
                discard()
                dropOutgoing()
            }
            else -> {}
        }
    }

    override fun onMessage(buffer: DataChannel.Buffer) {
        // The buffer is only valid during this call, so copy before the work moves to the file thread.
        val bytes = ByteArray(buffer.data.remaining()).also { buffer.data.get(it) }
        val binary = buffer.binary
        // A viewer cancel must reach a stream already running on the file thread, so it is noted here, not queued.
        if (!binary) noteOutgoingReply(bytes)
        post { if (binary) chunk(bytes) else control(bytes) }
    }

    private fun noteOutgoingReply(bytes: ByteArray) {
        val body = runCatching { JSONObject(String(bytes)) }.getOrNull() ?: return
        val id = body.optInt("id", -1)
        Log.i(TAG, "Viewer reply ${body.optString("t")} for offer $id")
        if (body.optString("t") in setOf("cancel", "reject", "failed") && outgoing?.id == id) outgoing?.abortRequested = true
    }

    private fun control(bytes: ByteArray) {
        val body = runCatching { JSONObject(String(bytes)) }.getOrNull() ?: return
        val id = body.optInt("id", -1)
        val sending = outgoing?.takeIf { it.id == id }
        when (body.optString("t")) {
            "offer" -> offer(id, body.optString("name"), body.optLong("size", 0))
            "end" -> finish(id, body.optString("sha256"))
            "cancel" -> {
                if (current?.id == id) discard()
                if (sending != null) finishOutgoing("The viewer cancelled ${sending.name}")
            }
            "accept" -> if (sending != null) stream(sending)
            "reject" -> if (sending != null) finishOutgoing("The viewer did not take ${sending.name}")
            "done" -> if (sending != null) finishOutgoing("Sent ${sending.name}")
            "failed" -> if (sending != null) finishOutgoing("${sending.name} did not arrive intact")
        }
    }

    private fun offerOutgoing(uri: Uri, onResult: (String) -> Unit) {
        val reason =
            when {
                outgoing != null || current != null -> "Finish the current transfer first."
                channel.state() != DataChannel.State.OPEN || !permitted() || !allowed() ->
                    "The viewer has no file permission for this connection."
                else -> null
            }
        if (reason != null) return onResult(reason)
        val info = describe(uri) ?: return onResult("That file cannot be read.")
        if (info.size <= 0 || info.size > MAX_OUTGOING) return onResult("That file is larger than 512 MB.")
        val id = nextOutgoingId
        if (id > 0x7ffffffe) return onResult("Restart sharing to send more files.")
        nextOutgoingId += 2
        outgoing = Outgoing(id, uri, info.name, info.size)
        HostState.status = "Offered ${info.name} to the viewer"
        send(JSONObject().put("t", "send").put("id", id).put("name", info.name).put("size", info.size))
        onResult("")
    }

    private class Described(val name: String, val size: Long)

    private fun describe(uri: Uri): Described? {
        val cursor = runCatching {
            context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
        }.getOrNull() ?: return null
        return cursor.use {
            if (!it.moveToFirst()) return@use null
            val name = safeName(it.getString(0).orEmpty()) ?: return@use null
            val size = if (it.isNull(1)) -1L else it.getLong(1)
            Described(name, size)
        }
    }

    /** Streams the offered file in order, checked against its announced length and SHA-256, while the viewer has permission. */
    private fun stream(out: Outgoing) {
        val input = runCatching { context.contentResolver.openInputStream(out.uri) }.getOrNull()
        if (input == null) {
            outgoing = null
            send(JSONObject().put("t", "cancel").put("id", out.id))
            return finishOutgoing("${out.name} could not be opened")
        }
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(MAX_CHUNK)
        var sent = 0L
        input.use { source ->
            while (true) {
                if (out.abortRequested || !allowed() || channel.state() != DataChannel.State.OPEN) {
                    Log.w(TAG, "Outgoing stopped: aborted=${out.abortRequested} allowed=${allowed()} open=${channel.state()}")
                    send(JSONObject().put("t", "cancel").put("id", out.id))
                    return finishOutgoing("Sending ${out.name} stopped")
                }
                // Hold back while the channel's send buffer is full so memory stays bounded.
                while (channel.bufferedAmount() > SEND_BUFFER_LIMIT && !out.abortRequested && channel.state() == DataChannel.State.OPEN) {
                    Thread.sleep(5)
                }
                val count = source.read(buffer, 0, MAX_CHUNK)
                if (count < 0) break
                if (count == 0) continue
                sent += count
                if (sent > out.size) {
                    send(JSONObject().put("t", "cancel").put("id", out.id))
                    return finishOutgoing("${out.name} grew while it was being sent")
                }
                digest.update(buffer, 0, count)
                channel.send(DataChannel.Buffer(ByteBuffer.wrap(outgoingFrame(out.id, buffer, count)), true))
                lastActivity = android.os.SystemClock.elapsedRealtime()
            }
        }
        if (sent != out.size) {
            send(JSONObject().put("t", "cancel").put("id", out.id))
            return finishOutgoing("${out.name} changed while it was being sent")
        }
        val hash = digest.digest().joinToString("") { "%02x".format(it) }
        send(JSONObject().put("t", "end").put("id", out.id).put("sha256", hash))
        HostState.status = "Waiting for the viewer to confirm ${out.name}"
    }

    private fun finishOutgoing(status: String) {
        outgoing?.let { runCatching { context.contentResolver.releasePersistableUriPermission(it.uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION) } }
        outgoing = null
        HostState.status = status
    }

    private fun dropOutgoing() {
        if (outgoing != null) finishOutgoing("File sending stopped")
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
            lastActivity = android.os.SystemClock.elapsedRealtime()
        }.onFailure { fail(incoming, "write") }
    }

    private fun finish(id: Int, sha256: String) {
        val incoming = current ?: return
        if (incoming.id != id) return
        if (!allowed()) return fail(incoming, "paused")
        val digest = incoming.digest.digest().joinToString("") { "%02x".format(it) }
        val intact = incoming.written == incoming.size && digest.equals(sha256, ignoreCase = true)
        if (!intact) return fail(incoming, "incomplete")
        runCatching {
            incoming.stream.flush()
            incoming.stream.close()
            // Flushing storage can outlast the current connection or its lease.
            if (!allowed()) return fail(incoming, "paused")
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

        // Largest file the phone offers: the viewer streams up to 512 MB without a disk sink.
        const val MAX_OUTGOING = 512L * 1024 * 1024
        private const val SEND_BUFFER_LIMIT = 1L shl 20

        /** One binary frame: the offer id as a big-endian integer, then the next bytes of the file. */
        fun outgoingFrame(id: Int, bytes: ByteArray, count: Int): ByteArray {
            val frame = ByteArray(4 + count)
            ByteBuffer.wrap(frame).putInt(id)
            System.arraycopy(bytes, 0, frame, 4, count)
            return frame
        }

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

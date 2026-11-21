package com.beaconremote.host

import android.app.Activity
import android.content.ClipboardManager
import android.os.Bundle
import java.util.concurrent.CompletableFuture

/** What the phone's clipboard held when read: text, formatted text, and an image's bytes with its type. */
internal class ClipSnapshot(val text: String?, val html: String?, val imageMime: String?, val image: ByteArray?, val file: android.net.Uri? = null)

/**
 * Android lets only the app that has focus read the clipboard. When a viewer asks and nothing could be read, the phone
 * puts this invisible screen in front for a moment, reads what is there, and leaves again.
 */
class ClipReadActivity : Activity() {
    private var done = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        overridePendingTransition(0, 0)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (!hasFocus || done) return
        done = true
        val snapshot = runCatching { read() }.getOrNull()
        ClipHandoff.pending?.complete(snapshot)
        ClipHandoff.pending = null
        finish()
        overridePendingTransition(0, 0)
    }

    override fun onDestroy() {
        ClipHandoff.pending?.complete(null)
        ClipHandoff.pending = null
        super.onDestroy()
    }

    private fun read(): ClipSnapshot? {
        val clip = getSystemService(ClipboardManager::class.java).primaryClip ?: return null
        if (clip.itemCount == 0) return null
        val item = clip.getItemAt(0)
        var imageMime: String? = null
        var image: ByteArray? = null
        item.uri?.let { uri ->
            val mime = contentResolver.getType(uri) ?: clip.description.getMimeType(0)
            if (mime.startsWith("image/")) {
                val bytes = runCatching {
                    contentResolver.openInputStream(uri)?.use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val chunk = ByteArray(8192)
                        while (true) {
                            val count = input.read(chunk)
                            if (count < 0) break
                            if (out.size() + count > MAX_IMAGE) return@use null
                            out.write(chunk, 0, count)
                        }
                        out.toByteArray()
                    }
                }.getOrNull()
                if (bytes != null && bytes.isNotEmpty()) {
                    imageMime = mime
                    image = bytes
                }
            }
        }
        // A copied file is a content address that is not an image; it is offered as a file, not read as text.
        val file = item.uri?.takeIf { image == null && it.authority?.endsWith(".clips") != true }
        val text = if (image != null || file != null) null else item.coerceToText(this)?.toString()
        return ClipSnapshot(text, item.htmlText, imageMime, image, file)
    }

    private companion object {
        const val MAX_IMAGE = 1_500_000
    }
}

internal object ClipHandoff {
    @Volatile var pending: CompletableFuture<ClipSnapshot?>? = null
}

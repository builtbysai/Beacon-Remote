package com.beaconremote.host

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class FileReceiverTest {
    @Test
    fun aProposedNameBecomesOneSafeComponent() {
        assertEquals("tool.exe", FileReceiver.safeName("tool.exe"))
        // Paths are cut to their last part; reserved characters are replaced; trailing dots and spaces go.
        assertEquals("evil.exe", FileReceiver.safeName("..\\..\\Windows\\evil.exe"))
        assertEquals("a_b_c.txt", FileReceiver.safeName("a:b*c.txt"))
        assertEquals("notes", FileReceiver.safeName("notes. . "))
        assertEquals("pic.png", FileReceiver.safeName("dir/pic.png"))
        assertNull(FileReceiver.safeName(""))
        assertNull(FileReceiver.safeName("..."))
        assertNull(FileReceiver.safeName("/"))
        // Length is bounded and the extension is kept.
        val long = "x".repeat(300) + ".zip"
        val safe = FileReceiver.safeName(long)!!
        assertEquals(124, safe.length)
        assertEquals(true, safe.endsWith(".zip"))
    }

    @Test
    fun outgoingFramesCarryTheOfferIdFirstAndTheExactBytesAfterIt() {
        val payload = byteArrayOf(9, 8, 7, 6, 5)
        val frame = FileReceiver.outgoingFrame(0x01020304, payload, 3)
        assertEquals(7, frame.size)
        // Big-endian id, as the viewer reads it, then only the bytes that were read.
        assertEquals(listOf<Byte>(1, 2, 3, 4, 9, 8, 7), frame.toList())
    }

    @Test
    fun outgoingFilesStayWithinTheSizeTheViewerStreams() {
        assertEquals(512L * 1024 * 1024, FileReceiver.MAX_OUTGOING)
        assertEquals(64 * 1024, FileReceiver.MAX_CHUNK)
    }
}

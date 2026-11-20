package com.beaconremote.host

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.projection.MediaProjection
import android.os.Build
import android.util.Log
import java.nio.ByteBuffer
import org.webrtc.audio.JavaAudioDeviceModule

/**
 * The phone's own sound (what apps play), for an attended screen share. WebRTC's audio module reads the microphone;
 * this callback replaces every buffer it reads with the captured playback sound, or with silence. The microphone's
 * samples are never passed on: the buffer is cleared first, so a failure here can only produce silence.
 */
internal class SoundCapture(
    private val projection: () -> MediaProjection?,
    /** Keep the microphone's samples and add the phone's playback sound to them (the owner allowed both). */
    private val mixMicrophone: Boolean = false,
) : JavaAudioDeviceModule.AudioBufferCallback {
    private var record: AudioRecord? = null
    private var failed = false

    @SuppressLint("MissingPermission")
    private fun open(rate: Int, channels: Int): AudioRecord? {
        if (failed || Build.VERSION.SDK_INT < 29) return null
        record?.let { return it }
        val media = projection() ?: return null
        return runCatching {
            val config = AudioPlaybackCaptureConfiguration.Builder(media)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
            val format = AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT).setSampleRate(rate)
                .setChannelMask(if (channels == 2) AudioFormat.CHANNEL_IN_STEREO else AudioFormat.CHANNEL_IN_MONO).build()
            AudioRecord.Builder().setAudioFormat(format).setAudioPlaybackCaptureConfig(config).build().also {
                it.startRecording()
                record = it
                Log.i("BeaconHost", "Phone sound capture started ($rate Hz, $channels channels)")
            }
        }.onFailure {
            failed = true
            Log.w("BeaconHost", "Phone sound capture is unavailable; sending silence", it)
        }.getOrNull()
    }

    override fun onBuffer(buffer: ByteBuffer, audioFormat: Int, channelCount: Int, sampleRate: Int, bytesRead: Int, captureTimeNs: Long): Long {
        val size = minOf(bytesRead, buffer.capacity())
        if (!mixMicrophone) {
            // Sound only: clear what the microphone wrote before anything else.
            buffer.clear()
            for (index in 0 until size) buffer.put(index, 0)
        }
        runCatching {
            val sound = open(sampleRate, channelCount)
            if (sound != null && audioFormat == AudioFormat.ENCODING_PCM_16BIT) {
                if (!mixMicrophone) {
                    buffer.clear()
                    sound.read(buffer, size, AudioRecord.READ_NON_BLOCKING)
                } else {
                    val extra = ByteBuffer.allocateDirect(size).order(java.nio.ByteOrder.nativeOrder())
                    val got = sound.read(extra, size, AudioRecord.READ_NON_BLOCKING)
                    val mic = buffer.duplicate().order(java.nio.ByteOrder.nativeOrder())
                    var index = 0
                    while (index + 1 < minOf(got, size)) {
                        val sum = mic.getShort(index) + extra.getShort(index)
                        mic.putShort(index, sum.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort())
                        index += 2
                    }
                }
            }
        }
        return captureTimeNs
    }

    fun stop() {
        runCatching { record?.stop() }
        runCatching { record?.release() }
        record = null
    }
}

package com.beaconremote.host

import android.content.Context
import org.webrtc.CapturerObserver
import org.webrtc.SurfaceTextureHelper
import org.webrtc.VideoCapturer
import org.webrtc.VideoFrame

/**
 * Feeds GPU textures from [StandingScreen] to a session whose encoder shares its graphics context.
 * While [allowed] is false (paused, no fresh lease) pictures are dropped.
 */
class PersistentCapturer(private val allowed: () -> Boolean, private val failed: (String) -> Unit) : VideoCapturer {
    private var observer: CapturerObserver? = null

    override fun initialize(helper: SurfaceTextureHelper?, context: Context?, observer: CapturerObserver) {
        this.observer = observer
    }

    override fun startCapture(width: Int, height: Int, framerate: Int) {
        StandingScreen.resize(width, height)
        StandingScreen.lost = { failed("Fast screen sharing was turned off") }
        observer?.onCapturerStarted(true)
        StandingScreen.sink = { frame -> if (allowed()) observer?.onFrameCaptured(frame) }
    }

    override fun stopCapture() {
        StandingScreen.sink = null
        StandingScreen.lost = null
        observer?.onCapturerStopped()
    }

    override fun changeCaptureFormat(width: Int, height: Int, framerate: Int) {
        StandingScreen.resize(width, height)
    }

    override fun dispose() {
        StandingScreen.sink = null
    }

    override fun isScreencast() = true
}

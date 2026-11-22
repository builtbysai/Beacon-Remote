package com.beaconremote.host

/**
 * Library switches that apply for the whole process, so every place that initialises WebRTC passes the same string.
 * ForceSendPlayoutDelay tells the viewer's browser to show each picture as soon as it is decoded, with no jitter
 * buffer: a screen is watched live, and the receiver's own buffering was about 80-100 ms of every tap's response.
 */
object WebRtcTrials {
    const val FIELD_TRIALS = "WebRTC-ForceSendPlayoutDelay/min_ms:0,max_ms:0/"
}

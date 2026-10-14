package com.beaconremote.host

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import org.json.JSONObject

/** Hosts the one active sharing session, with a notification that cannot be missed and always offers Stop. */
class CaptureService : Service() {
    private var session: ShareSession? = null
    private var paused = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                session?.stop() ?: stopSelf()
                return START_NOT_STICKY
            }
            ACTION_PAUSE -> {
                paused = !paused
                session?.setPaused(paused)
                getSystemService(NotificationManager::class.java)
                    .notify(3, build(intent.getStringExtra("controller") ?: "", paused))
                return START_NOT_STICKY
            }
        }
        val raw = intent?.getStringExtra("grant")
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>("data")
        if (raw == null || data == null || session != null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val grant = Grant.from(JSONObject(raw))
        ServiceCompat.startForeground(
            this,
            3,
            build(grant.controller, paused = false),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
        )
        HostState.sharing = true
        HostState.status = "Sharing your screen"
        session =
            ShareSession(applicationContext, grant, Identity(this).server, data) { _ ->
                HostState.sharing = false
                HostState.status = "Available"
                session = null
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }.also { it.start() }
        return START_NOT_STICKY
    }

    private fun build(controller: String, paused: Boolean): Notification {
        fun action(name: String) =
            PendingIntent.getService(
                this,
                name.hashCode(),
                Intent(this, CaptureService::class.java).setAction(name).putExtra("controller", controller),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(this, AvailabilityService.SHARING)
            .setSmallIcon(android.R.drawable.presence_video_online)
            .setContentTitle(if (paused) "Sharing is paused" else "Sharing your screen")
            .setContentText(controller)
            .setOngoing(true)
            // Stop must stay reachable, and visible, even on a locked screen.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, if (paused) "Resume" else "Pause", action(ACTION_PAUSE))
            .addAction(0, "Stop", action(ACTION_STOP))
            .build()
    }

    override fun onDestroy() {
        session?.stop()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.beaconremote.host.STOP_SHARING"
        const val ACTION_PAUSE = "com.beaconremote.host.PAUSE_SHARING"
    }
}

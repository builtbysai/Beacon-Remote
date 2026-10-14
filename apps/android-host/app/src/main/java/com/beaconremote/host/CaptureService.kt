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
    private var controlling = false
    private var controller = ""

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
                refresh()
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
        controller = grant.controller
        ServiceCompat.startForeground(
            this,
            3,
            build(),
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
        )
        HostState.sharing = true
        HostState.status = "Sharing your screen"
        // Control happens only if the person chose it on the request screen and the accessibility service is on.
        val control = intent.getBooleanExtra("control", false) && ControlService.instance != null
        session =
            ShareSession(
                applicationContext,
                grant,
                Identity(this).server,
                data,
                control,
                { active ->
                    controlling = active
                    HostState.controlling = active
                    refresh()
                },
            ) { _ ->
                HostState.sharing = false
                HostState.controlling = false
                HostState.status = "Available"
                session = null
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            }.also { it.start() }
        return START_NOT_STICKY
    }

    private fun refresh() = getSystemService(NotificationManager::class.java).notify(3, build())

    private fun build(): Notification {
        fun action(name: String) =
            PendingIntent.getService(
                this,
                name.hashCode(),
                Intent(this, CaptureService::class.java).setAction(name),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(this, AvailabilityService.SHARING)
            .setSmallIcon(R.drawable.ic_stat_beacon)
            .setContentTitle(
                when {
                    paused -> "Sharing is paused"
                    controlling -> "Sharing and being controlled"
                    else -> "Sharing your screen"
                },
            )
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

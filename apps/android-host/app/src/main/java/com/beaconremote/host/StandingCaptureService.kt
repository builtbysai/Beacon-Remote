package com.beaconremote.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/**
 * Holds Android's screen capture open for fast sharing (see [StandingScreen]). It is visible the whole time: Android's
 * cast icon, and this notification with a Turn off button.
 */
class StandingCaptureService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            StandingScreen.stop()
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        val resultCode = intent?.getIntExtra(EXTRA_CODE, 0) ?: 0
        @Suppress("DEPRECATION")
        val data = intent?.getParcelableExtra<Intent>(EXTRA_DATA)
        if (resultCode == 0 || data == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Fast screen sharing", NotificationManager.IMPORTANCE_LOW))
        ServiceCompat.startForeground(this, NOTIFICATION, build(), ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
        val started = StandingScreen.start(this, resultCode, data) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        if (!started) {
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    private fun build(): Notification {
        val stop = PendingIntent.getService(
            this, 11, Intent(this, StandingCaptureService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_beacon)
            .setContentTitle("Fast screen sharing is on")
            .setContentText("Smooth video for approved viewers. Nothing is sent until someone connects.")
            .setOngoing(true)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .addAction(0, "Turn off", stop)
            .build()
    }

    override fun onDestroy() {
        StandingScreen.stop(notify = false)
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "standing"
        private const val NOTIFICATION = 12
        const val ACTION_STOP = "com.beaconremote.host.STOP_STANDING"
        const val EXTRA_CODE = "code"
        const val EXTRA_DATA = "data"
    }
}

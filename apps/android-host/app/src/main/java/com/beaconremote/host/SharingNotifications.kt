package com.beaconremote.host

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.provider.Settings

internal object SharingNotifications {
    const val CHANNEL = "sharing"

    fun register(context: Context) {
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, "While sharing", NotificationManager.IMPORTANCE_LOW),
        )
    }

    fun ready(context: Context): Boolean {
        val manager = context.getSystemService(NotificationManager::class.java)
        val importance = manager.getNotificationChannel(CHANNEL)?.importance ?: return false
        return manager.areNotificationsEnabled() && importance > NotificationManager.IMPORTANCE_NONE
    }

    fun settings(context: Context): Intent {
        val manager = context.getSystemService(NotificationManager::class.java)
        return if (manager.areNotificationsEnabled()) {
            Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                .putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL)
        } else {
            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
        }
    }
}

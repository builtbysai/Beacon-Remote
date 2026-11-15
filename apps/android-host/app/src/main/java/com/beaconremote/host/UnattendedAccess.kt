package com.beaconremote.host

import android.app.KeyguardManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationManagerCompat

object UnattendedAccess {
    fun ready(context: Context): Boolean = Build.VERSION.SDK_INT >= 30 &&
        ControlService.enabled(context) && ControlService.instance != null &&
        NotificationManagerCompat.from(context).areNotificationsEnabled() &&
        context.getSystemService(KeyguardManager::class.java).let { !it.isDeviceLocked && !it.isKeyguardLocked }

    // Policy approval of remembered helpers must never inherit the owner's unattended opt-in.
    fun accepts(local: Boolean, policy: Boolean, helper: Boolean, ready: Boolean): Boolean = local && policy && !helper && ready
}

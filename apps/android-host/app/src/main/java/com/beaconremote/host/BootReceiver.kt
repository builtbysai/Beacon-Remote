package com.beaconremote.host

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart, becomes available again only if the person had left this phone available. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        val identity = Identity(context)
        if (identity.paired && identity.wantsAvailable) AvailabilityService.start(context)
    }
}

package com.beaconremote.host

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.widget.Toast
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
            ACTION_ALLOW_PERMISSION, ACTION_DECLINE_PERMISSION -> {
                session?.decidePermission(
                    intent.getStringExtra("session").orEmpty(),
                    intent.getStringExtra("request").orEmpty(),
                    intent.getLongExtra("generation", -1),
                    intent.action == ACTION_ALLOW_PERMISSION,
                )
                return START_NOT_STICKY
            }
            ACTION_SEND_FILE -> {
                val uri = intent.data
                val current = session
                if (uri == null) return START_NOT_STICKY
                if (current == null) {
                    notice("Sharing has ended, so no file was sent.")
                } else {
                    current.sendFile(uri) { reason -> if (reason.isNotEmpty()) notice(reason) }
                }
                refresh()
                return START_NOT_STICKY
            }
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
        if (session != null) return START_NOT_STICKY
        val unattended = intent?.getBooleanExtra("unattended", false) == true
        val rawGrant = raw?.let { runCatching { JSONObject(it) }.getOrNull() }
        val identity = Identity(this)
        if (rawGrant == null || !identity.paired || intent?.accessBinding() != identity.accessBinding()) {
            stopSelf()
            return START_NOT_STICKY
        }
        val grant = Grant.from(rawGrant)
        if (!identity.wantsAvailable || !SharingNotifications.ready(this) || (!unattended && data == null) ||
            (unattended && !UnattendedAccess.accepts(identity.unattended,
                rawGrant.optString("approval") == "policy", rawGrant.optBoolean("viaRelationship"), UnattendedAccess.ready(this)))) {
            // Local settings can change after consent and before service startup.
            ShareSession(applicationContext, grant, identity.server, null) {}.decline()
            stopSelf()
            return START_NOT_STICKY
        }
        controller = grant.controller
        ServiceCompat.startForeground(
            this,
            3,
            build(),
            if (unattended) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION,
        )
        HostState.sharing = true
        HostState.status = "Sharing your screen"
        // Control happens only if the person chose it on the request screen and the accessibility service is on.
        val control = (unattended || intent.getBooleanExtra("control", false)) && ControlService.instance != null
        // Receiving files is only ever what the person ticked on the request screen.
        val files = (unattended || intent.getBooleanExtra("files", false)) && FileReceiver.supported
        session =
            ShareSession(
                applicationContext,
                grant,
                identity.server,
                data,
                control,
                files,
                unattended,
                { active ->
                    controlling = active
                    HostState.controlling = active
                    refresh()
                },
                ::showPermissionPrompt,
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

    private fun notice(text: String) {
        Handler(Looper.getMainLooper()).post { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }
    }

    private fun refresh() = getSystemService(NotificationManager::class.java).notify(3, build())

    private fun showPermissionPrompt(prompt: LivePermissionPrompt?) {
        val manager = getSystemService(NotificationManager::class.java)
        if (prompt == null) {
            manager.cancel(PERMISSION_NOTIFICATION)
            return
        }
        fun action(name: String): PendingIntent {
            val decision = Intent(this, CaptureService::class.java).setAction(name)
                .setData(Uri.Builder().scheme("beacon-remote").authority("permission").appendPath(prompt.id).build())
                .putExtra("session", prompt.sessionId)
                .putExtra("request", prompt.id)
                .putExtra("generation", prompt.generation)
            return PendingIntent.getService(this, 0, decision, PendingIntent.FLAG_IMMUTABLE)
        }
        val input = prompt.scope == LivePermission.CONTROL
        manager.notify(PERMISSION_NOTIFICATION, NotificationCompat.Builder(this, SharingNotifications.CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_beacon)
            .setContentTitle(if (input) "Allow this viewer to control the phone?" else "Allow this viewer to send files?")
            .setContentText(if (input) "They can touch and type until this connection ends. Pause or Stop at any time."
                else "Files are saved in Downloads/Beacon Remote during this connection.")
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setTimeoutAfter(prompt.timeoutMs)
            .addAction(0, "Decline", action(ACTION_DECLINE_PERMISSION))
            .addAction(0, if (input) "Allow control" else "Allow files", action(ACTION_ALLOW_PERMISSION))
            .build())
    }

    private fun build(): Notification {
        fun action(name: String) =
            PendingIntent.getService(
                this,
                name.hashCode(),
                Intent(this, CaptureService::class.java).setAction(name),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(this, SharingNotifications.CHANNEL)
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
            .apply {
                if (session?.canSendFile() == true && !paused) {
                    addAction(0, "Send file", PendingIntent.getActivity(this@CaptureService, 2, Intent(this@CaptureService, SendFileActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
                }
            }
            .addAction(0, "Stop", action(ACTION_STOP))
            .build()
    }

    override fun onDestroy() {
        showPermissionPrompt(null)
        session?.stop()
        super.onDestroy()
    }

    companion object {
        private const val PERMISSION_NOTIFICATION = 4
        private const val ACTION_ALLOW_PERMISSION = "com.beaconremote.host.ALLOW_PERMISSION"
        private const val ACTION_DECLINE_PERMISSION = "com.beaconremote.host.DECLINE_PERMISSION"
        const val ACTION_STOP = "com.beaconremote.host.STOP_SHARING"
        const val ACTION_PAUSE = "com.beaconremote.host.PAUSE_SHARING"
        const val ACTION_SEND_FILE = "com.beaconremote.host.SEND_FILE"
    }
}

package com.beaconremote.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlin.concurrent.thread
import org.json.JSONObject

/** What the screen shows about this phone. Read by the main screen once a second. */
object HostState {
    @Volatile var status: String = "Not available"
    @Volatile var sharing: Boolean = false
}

/**
 * Keeps this phone reachable: signed presence to the server, held open until someone asks for the screen.
 * A request is never acted on here. It opens a visible consent screen, and nothing is captured until the
 * person taps Allow and Android's own screen-capture prompt is accepted.
 */
class AvailabilityService : Service() {
    @Volatile private var running = false
    private var worker: Thread? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Identity(this).wantsAvailable = false
            running = false
            HostState.status = "Not available"
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
        if (running) return START_STICKY
        val identity = Identity(this)
        if (!identity.paired) {
            stopSelf()
            return START_NOT_STICKY
        }
        identity.wantsAvailable = true
        channels()
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, AvailabilityService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val notification: Notification =
            NotificationCompat.Builder(this, AVAILABLE)
                .setSmallIcon(R.drawable.ic_stat_beacon)
                .setContentTitle("Beacon Remote is available")
                .setContentText("Someone you allow can ask to see this screen. You approve each request.")
                .setContentIntent(open)
                .addAction(0, "Stop", stop)
                .setOngoing(true)
                .build()
        ServiceCompat.startForeground(this, 1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        running = true
        worker = thread(name = "presence") { loop(identity) }
        return START_STICKY
    }

    private fun loop(identity: Identity) {
        var handled: String? = null
        var delay = 2000L
        while (running) {
            try {
                HostState.status = if (HostState.sharing) "Sharing your screen" else "Available"
                val reply = Api.heartbeat(identity, wait = true, handled = handled)
                delay = 2000L
                val sessions = reply.optJSONArray("sessions")
                if (sessions != null && sessions.length() > 0 && !HostState.sharing) {
                    val grant = sessions.getJSONObject(0)
                    handled = grant.getString("id")
                    askForConsent(grant)
                } else if (sessions == null || sessions.length() == 0) {
                    handled = null
                }
                val pause = reply.optLong("pollAfterMillis", 0)
                if (pause > 0) Thread.sleep(pause)
            } catch (rejected: Api.Rejected) {
                HostState.status = "This phone was removed from your account"
                identity.wantsAvailable = false
                running = false
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
            } catch (error: InterruptedException) {
                return
            } catch (error: Exception) {
                HostState.status = "Offline, retrying"
                runCatching { Thread.sleep(delay) }
                delay = minOf(delay * 2, 30_000L)
            }
        }
    }

    private fun askForConsent(grant: JSONObject) {
        val consent =
            Intent(this, ConsentActivity::class.java)
                .putExtra("grant", grant.toString())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(this, 2, consent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(
            2,
            NotificationCompat.Builder(this, REQUEST)
                .setSmallIcon(R.drawable.ic_stat_beacon)
                .setContentTitle("Request to see your screen")
                .setContentText("${grant.optString("controller", "Someone")} is asking. Tap to review.")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(pending)
                .setFullScreenIntent(pending, true)
                .setTimeoutAfter(120_000)
                .setAutoCancel(true)
                .build(),
        )
        // With the app already in front, show the request at once as well.
        runCatching { startActivity(consent) }
    }

    private fun channels() {
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(AVAILABLE, "Availability", NotificationManager.IMPORTANCE_LOW))
        manager.createNotificationChannel(NotificationChannel(REQUEST, "Requests to see your screen", NotificationManager.IMPORTANCE_HIGH))
        manager.createNotificationChannel(NotificationChannel(SHARING, "While sharing", NotificationManager.IMPORTANCE_LOW))
    }

    override fun onDestroy() {
        running = false
        worker?.interrupt()
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.beaconremote.host.STOP_AVAILABILITY"
        const val AVAILABLE = "available"
        const val REQUEST = "request"
        const val SHARING = "sharing"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, AvailabilityService::class.java))
        }
    }
}

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
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlin.concurrent.thread
import org.json.JSONObject

/** What the screen shows about this phone. Read by the main screen once a second. */
object HostState {
    @Volatile var status: String = "Not available"
    @Volatile var sharing: Boolean = false
    @Volatile var controlling: Boolean = false
}

/**
 * Keeps this phone reachable: signed presence to the server, held open until someone asks for the screen.
 * A request is never acted on here. It opens a visible consent screen, and nothing is captured until the
 * person taps Allow and Android's own screen-capture prompt is accepted.
 */
class AvailabilityService : Service() {
    @Volatile private var running = false
    private var worker: Thread? = null
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var generation = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            Identity(this).wantsAvailable = false
            if (HostState.sharing) runCatching { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP)) }
            running = false
            generation++
            worker?.interrupt()
            HostState.status = "Not available"
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }
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
                .setContentText(if (identity.unattended) "Your account can connect while this phone is unlocked. Tap to manage access." else "Someone you allow can ask to see this screen. You approve each request.")
                .setContentIntent(open)
                .addAction(0, "Stop", stop)
                .setOngoing(true)
                .build()
        ServiceCompat.startForeground(this, 1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        if (running) return START_STICKY
        running = true
        val run = ++generation
        val binding = identity.accessBinding()
        worker = thread(name = "presence") { loop(identity, run, binding) }
        return START_STICKY
    }

    private fun loop(identity: Identity, run: Long, binding: AccessBinding) {
        fun active() = running && generation == run && identity.wantsAvailable && identity.accessBinding() == binding
        // All effects run on the service lifecycle thread. Stop/restart and a
        // queued old response therefore have a defined order, without holding
        // a lifecycle lock across network I/O.
        fun apply(action: () -> Unit) {
            main.post {
                if (!active()) return@post
                try { action() } catch (_: Exception) {
                    running = false
                    generation++
                    identity.wantsAvailable = false
                    HostState.status = "Availability stopped. Open Beacon Remote to retry."
                    runCatching { startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP)) }
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        val delivery = ConsentRequestDelivery()
        var delay = 2000L
        while (active()) {
            try {
                apply { HostState.status = if (HostState.sharing) "Sharing your screen" else "Available" }
                val accessRevision = AccessIntents.fence.revision()
                val before = identity.unattended
                val reply = Api.heartbeat(identity, wait = true, handled = delivery.handled, expected = binding)
                if (!active()) return
                val access = reply.optJSONObject("access")
                if (!before && access?.optString("mode") == "trusted") {
                    // A local disable wins even if its earlier request failed.
                    Api.setAccess(identity, false, expected = binding, onlyIfLocallyDisabled = true)
                }
                delay = 2000L
                val sessions = reply.optJSONArray("sessions")
                val grant = if (sessions != null && sessions.length() > 0) sessions.getJSONObject(0) else null
                apply {
                    val trusted = access?.optString("mode") == "trusted" && access.optBoolean("allowControl")
                    if (before && AccessIntents.fence.revision() == accessRevision && identity.unattended && access != null && !trusted) {
                        identity.unattended = false
                        startService(Intent(this, CaptureService::class.java).setAction(CaptureService.ACTION_STOP))
                    }
                    if (grant != null && delivery.claim(grant.getString("id"), HostState.sharing)) {
                        if (UnattendedAccess.accepts(identity.unattended, grant.optString("approval") == "policy", grant.optBoolean("viaRelationship"), UnattendedAccess.ready(this))) {
                            startForegroundService(Intent(this, CaptureService::class.java)
                                .putExtra("grant", grant.toString()).putExtra("unattended", true))
                        } else if (grant.optString("approval") == "policy") {
                            ShareSession(applicationContext, Grant.from(grant), binding.server, null) {}.decline()
                        } else {
                            askForConsent(grant)
                        }
                    }
                }
                val pause = reply.optLong("pollAfterMillis", 0)
                if (pause > 0) Thread.sleep(pause)
            } catch (rejected: Api.Rejected) {
                apply {
                    HostState.status = "This phone was removed from your account"
                    identity.wantsAvailable = false
                    running = false
                    generation++
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
                return
            } catch (error: InterruptedException) {
                return
            } catch (error: Exception) {
                if (!active()) return
                apply { HostState.status = "Offline, retrying" }
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
        SharingNotifications.register(this)
    }

    override fun onDestroy() {
        running = false
        generation++
        worker?.interrupt()
        main.removeCallbacksAndMessages(null)
        super.onDestroy()
    }

    companion object {
        const val ACTION_STOP = "com.beaconremote.host.STOP_AVAILABILITY"
        const val AVAILABLE = "available"
        const val REQUEST = "request"

        fun start(context: Context) {
            context.startForegroundService(Intent(context, AvailabilityService::class.java))
        }
    }
}

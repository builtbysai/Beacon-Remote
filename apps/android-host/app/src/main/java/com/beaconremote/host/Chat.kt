package com.beaconremote.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.RemoteInput
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Session chat on the phone. A viewer's message arrives on the open control channel and shows as a notification the
 * person can answer from the notification itself; the reply goes back on the same channel. Nothing is stored.
 */
internal object Chat {
    private const val CHANNEL = "chat"
    private const val ID = 4242
    const val ACTION_REPLY = "com.beaconremote.host.CHAT_REPLY"
    const val KEY = "reply"
    const val MAX_CHARS = 300

    /** Set by the control channel while it is open; null when there is nowhere to send a reply. */
    @Volatile var send: ((String) -> Boolean)? = null

    fun show(context: Context, text: String, note: String? = null) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "Messages from the viewer", NotificationManager.IMPORTANCE_HIGH))
        val reply = PendingIntent.getBroadcast(
            context, 0, Intent(ACTION_REPLY).setPackage(context.packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
        )
        val action = Notification.Action.Builder(null, "Reply", reply)
            .addRemoteInput(RemoteInput.Builder(KEY).setLabel("Reply to the viewer").build()).build()
        manager.notify(
            ID,
            Notification.Builder(context, CHANNEL).setSmallIcon(R.drawable.ic_stat_beacon)
                .setContentTitle(note ?: "Message from the viewer").setContentText(text)
                .setStyle(Notification.BigTextStyle().bigText(text))
                .setAutoCancel(false).setOnlyAlertOnce(false).addAction(action).build(),
        )
    }
}

class ChatReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val text = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Chat.KEY)?.toString()?.trim().orEmpty()
        if (text.isEmpty()) return
        val sent = Chat.send?.invoke(text.take(Chat.MAX_CHARS)) == true
        Log.i("BeaconHost", "Chat reply from the phone: ${text.length} characters, sent=$sent")
        // Replacing the notification also stops its reply spinner.
        Chat.show(context, if (sent) "You: $text" else "Not sent: the viewer is no longer connected.", if (sent) "Sent to the viewer" else "Chat")
    }
}

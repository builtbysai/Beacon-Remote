package com.beaconremote.host

/** Acknowledges only requests actually delivered in this availability run. */
internal class ConsentRequestDelivery {
    @Volatile var handled: String? = null
        private set

    @Synchronized fun claim(id: String?, sharing: Boolean): Boolean {
        // Idle polls must not forget a request whose consent/capture dialog is
        // still open. A new request arriving during an old session's shutdown
        // must remain eligible once sharing has stopped.
        if (id == null || sharing || id == handled) return false
        handled = id
        return true
    }
}

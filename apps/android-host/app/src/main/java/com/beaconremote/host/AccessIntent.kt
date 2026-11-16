package com.beaconremote.host

/** A stale network result cannot restore access after Disable or re-pairing. */
data class AccessBinding(val server: String, val machineId: String)

class AccessIntentFence {
    data class Ticket(val version: Long, val binding: AccessBinding)
    private var version = 0L
    private var pending: Ticket? = null

    @Synchronized fun begin(binding: AccessBinding): Ticket {
        check(version < Long.MAX_VALUE)
        return Ticket(++version, binding).also { pending = it }
    }
    @Synchronized fun invalidate(write: () -> Unit = {}) {
        check(version < Long.MAX_VALUE)
        version++
        pending = null
        write()
    }
    @Synchronized fun revision() = version
    @Synchronized fun pending(binding: AccessBinding) = pending?.binding == binding
    @Synchronized fun current(ticket: Ticket, binding: AccessBinding) = ticket.version == version && ticket.binding == binding
    @Synchronized fun apply(ticket: Ticket, binding: AccessBinding, write: () -> Unit): Boolean {
        if (!current(ticket, binding) || pending != ticket) return false
        write()
        pending = null
        return true
    }
    @Synchronized fun finish(ticket: Ticket) { if (pending == ticket) pending = null }
}

object AccessIntents {
    val fence = AccessIntentFence()
    @Volatile var notice: Pair<AccessBinding, String>? = null
}

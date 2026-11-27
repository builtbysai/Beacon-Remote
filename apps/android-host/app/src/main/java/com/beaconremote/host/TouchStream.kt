package com.beaconremote.host

/** One finger, one in-flight OS gesture, latest position only. No replay of an accumulated drag. */
internal class TouchStream(
    private val allowed: () -> Boolean,
    private val post: (() -> Unit) -> Unit,
    private val dispatch: (Segment, (Boolean) -> Unit) -> Boolean,
    private val interrupted: () -> Unit = {},
    private val closedIdle: () -> Unit = {},
) {
    data class Point(val x: Int, val y: Int)
    data class Segment(val from: Point, val to: Point, val beginning: Boolean, val continues: Boolean, val durationMs: Long)
    private class Contact(val start: Point) {
        var target = start
        var released = false
        var cancelled = false
    }
    private class Flight(val contact: Contact, val segment: Segment)
    private val queue = java.util.ArrayDeque<Contact>()
    private var cursor: Point? = null
    private var flight: Flight? = null
    private var scheduled = false
    private var closed = false
    private var idleNotified = false

    @Synchronized fun press(point: Point): Boolean {
        if (closed || !allowed() || queue.lastOrNull()?.released == false) return false
        if (queue.size >= 8) { cancel(); return false }
        queue.addLast(Contact(point))
        schedule()
        return true
    }

    @Synchronized fun move(point: Point) {
        queue.lastOrNull()?.takeIf { !it.released && !it.cancelled }?.target = point
        schedule()
    }

    @Synchronized fun lift(point: Point) {
        queue.lastOrNull()?.takeIf { !it.released }?.let { it.target = point; it.released = true }
        schedule()
    }

    /** Drop pending presses and motion; an existing contact gets only a same-position lift. */
    @Synchronized fun cancel() {
        while (queue.size > 1) queue.removeLast()
        queue.firstOrNull()?.let { it.cancelled = true; it.released = true }
        if (flight == null && cursor == null) queue.clear()
        schedule()
    }

    @Synchronized fun close() { closed = true; cancel() }

    private fun schedule() {
        if (!scheduled) { scheduled = true; post { drain() } }
    }

    @Synchronized private fun drain() {
        scheduled = false
        if (flight != null) return
        if (closed || !allowed()) {
            while (queue.size > 1) queue.removeLast()
            queue.firstOrNull()?.let { it.cancelled = true; it.released = true }
        }
        val contact = queue.firstOrNull()
        if (contact == null) {
            if (closed && !idleNotified) { idleNotified = true; closedIdle() }
            return
        }
        val previous = cursor
        if (previous == null && contact.cancelled) {
            queue.removeFirst()
            schedule()
            return
        }
        if (previous != null && !contact.released && contact.target == previous) return
        val continuing = !contact.released && !contact.cancelled
        val target = if (contact.cancelled) previous!! else contact.target
        val segment = Segment(previous ?: contact.start, target, previous == null, continuing,
            if (previous != null && !continuing) 1 else 16)
        val next = Flight(contact, segment)
        flight = next
        val accepted = dispatch(segment) { success -> complete(next, success) }
        if (!accepted && flight === next) complete(next, false)
    }

    @Synchronized private fun complete(completed: Flight, success: Boolean) {
        if (flight !== completed) return
        flight = null
        if (!success) {
            // An OS cancellation is local takeover; never replay old queued motion afterward.
            cursor = null
            queue.clear()
            interrupted()
        } else {
            cursor = if (completed.segment.continues) completed.segment.to else null
            if (!completed.segment.continues) queue.removeFirst()
        }
        schedule()
    }
}

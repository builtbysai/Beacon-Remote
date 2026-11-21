package com.beaconremote.host

/** Mutated by the signaling worker. Capture and data-channel callbacks read its published snapshot. */
internal class ViewerConnection {
    private data class State(val generation: Long, val attached: Boolean, val connected: Boolean)
    @Volatile private var state = State(0, attached = true, connected = false)

    val generation: Long get() = state.generation

    fun owns(generation: Long): Boolean = state.let { it.attached && it.generation == generation }
    fun connected(generation: Long): Boolean =
        state.let { it.attached && it.generation == generation && it.connected }

    fun connectionChanged(generation: Long, connected: Boolean): Boolean {
        val previous = state
        if (!previous.attached || previous.generation != generation) return false
        state = previous.copy(connected = connected)
        return true
    }

    fun detach() {
        state = state.copy(attached = false, connected = false)
    }

    fun resume(generation: Long): Boolean {
        if (generation <= state.generation) return false
        state = State(generation, attached = true, connected = false)
        return true
    }
}

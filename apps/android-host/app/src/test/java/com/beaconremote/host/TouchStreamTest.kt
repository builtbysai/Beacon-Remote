package com.beaconremote.host

import org.junit.Assert.*
import org.junit.Test

class TouchStreamTest {
    private class Fixture {
        var allowed = true
        var accepted = true
        var interruptions = 0
        var idle = 0
        val tasks = java.util.ArrayDeque<() -> Unit>()
        val callbacks = java.util.ArrayDeque<(Boolean) -> Unit>()
        val segments = mutableListOf<TouchStream.Segment>()
        val stream = TouchStream({ allowed }, { tasks.addLast(it) }, { segment, done ->
            segments.add(segment)
            if (accepted) callbacks.addLast(done)
            accepted
        }, { interruptions++ }, { idle++ })
        fun run() { repeat(100) { if (tasks.isEmpty()) return; tasks.removeFirst().invoke() }; error("Unbounded touch work") }
        fun complete(success: Boolean = true) { callbacks.removeFirst().invoke(success); run() }
    }
    private val origin = TouchStream.Point(10, 20)

    @Test fun dragMovesBeforeReleaseAndCoalescesToTheNewestPoint() {
        val f = Fixture()
        assertTrue(f.stream.press(origin)); f.run(); f.complete()
        assertTrue(f.segments.single().continues)
        repeat(100) { f.stream.move(TouchStream.Point(it + 20, 40)) }
        f.run()
        assertEquals(2, f.segments.size)
        assertEquals(TouchStream.Point(119, 40), f.segments.last().to)
        assertFalse(f.segments.last().beginning)
        f.complete()
        f.stream.lift(TouchStream.Point(120, 40)); f.run()
        assertFalse(f.segments.last().continues)
        f.complete()
        assertEquals(3, f.segments.size)
    }

    @Test fun aStationaryPressStaysDownWithoutRepeatedInjectionUntilLift() {
        val f = Fixture(); f.stream.press(origin); f.run(); f.complete()
        f.run(); assertEquals(1, f.segments.size)
        f.stream.lift(origin); f.run()
        assertEquals(origin, f.segments.last().to)
        assertFalse(f.segments.last().continues)
    }

    @Test fun rapidTapsRemainSeparateAndOnlyOneGestureIsInFlight() {
        val f = Fixture()
        repeat(3) { f.stream.press(origin); f.stream.lift(origin) }
        f.run(); assertEquals(1, f.segments.size)
        repeat(3) { f.complete() }
        assertEquals(3, f.segments.size)
        assertTrue(f.segments.all { it.beginning && !it.continues })
    }

    @Test fun revokeDuringFlightDropsQueuedMotionAndOnlyLiftsAtTheCommittedPoint() {
        val f = Fixture(); f.stream.press(origin); f.run()
        f.stream.move(TouchStream.Point(900, 900))
        f.stream.lift(TouchStream.Point(901, 900))
        f.stream.press(TouchStream.Point(500, 500))
        f.allowed = false
        f.complete()
        assertEquals(2, f.segments.size)
        val release = f.segments.last()
        assertEquals(origin, release.from); assertEquals(origin, release.to)
        assertFalse(release.beginning); assertFalse(release.continues)
        f.complete(); assertFalse(f.stream.press(origin))
    }

    @Test fun stopBeforeDispatchInjectsNothingAndStopDuringFlightDrainsBeforeClosing() {
        val early = Fixture(); early.stream.press(origin); early.stream.close(); early.run()
        assertTrue(early.segments.isEmpty()); assertEquals(1, early.idle)
        val active = Fixture(); active.stream.press(origin); active.run(); active.stream.close(); active.run()
        assertEquals(0, active.idle)
        active.complete(); assertFalse(active.segments.last().continues)
        active.complete(); assertEquals(1, active.idle)
        assertFalse(active.stream.press(origin))
    }

    @Test fun localCancellationNeverReplaysPendingMovementOrQueuedClicks() {
        val f = Fixture(); f.stream.press(origin); f.run()
        f.stream.move(TouchStream.Point(200, 200)); f.stream.lift(origin); f.stream.press(origin)
        f.complete(false)
        assertEquals(1, f.segments.size); assertEquals(1, f.interruptions)
        assertTrue(f.stream.press(origin))
    }

    @Test fun aFloodCannotBecomeAnUnboundedQueueOfDelayedClicks() {
        val f = Fixture()
        repeat(8) { assertTrue(f.stream.press(origin)); f.stream.lift(origin) }
        assertFalse(f.stream.press(origin)); f.run()
        assertTrue(f.segments.isEmpty())
    }

    @Test fun rejectedDispatchAndDuplicateCallbacksCannotRestartOldInput() {
        val rejected = Fixture(); rejected.accepted = false
        rejected.stream.press(origin); rejected.run()
        assertEquals(1, rejected.interruptions)
        val f = Fixture(); f.stream.press(origin); f.run()
        val callback = f.callbacks.first
        f.stream.close(); f.complete(); callback(true); f.run()
        assertEquals(2, f.segments.size)
        f.complete(); assertEquals(1, f.idle)
    }
}

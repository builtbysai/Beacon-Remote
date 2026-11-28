package com.beaconremote.host

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.view.View

/**
 * The cast from the web workspace (apps/web/src/Characters.tsx), drawn natively: a small monitor with a face and stub
 * arms. The signal arcs mean "reachable": awake and waving computers have them, sleeping and locked ones do not. State is
 * told by the face and the arcs, never by colour alone. Purely decorative for accessibility; the text beside it says the
 * state. It does not move (work screens stay still, review R17).
 */
class Character(context: Context, tone: Tone = Tone.BLUE, mood: Mood = Mood.AWAKE) : View(context) {
    enum class Tone { BLUE, SUN, CORAL, MINT }
    enum class Mood { AWAKE, WAVE, ASLEEP, LOCKED, WOW }

    var tone: Tone = tone
        set(value) { if (field != value) { field = value; invalidate() } }
    var mood: Mood = mood
        set(value) { if (field != value) { field = value; invalidate() } }

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }
    private val path = Path()
    private val rect = RectF()

    init {
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        // The web viewBox is "-12 -22 144 150"; fit it, centred, into the view.
        val scale = minOf(width / VIEW_W, height / VIEW_H)
        canvas.save()
        canvas.translate((width - VIEW_W * scale) / 2f, (height - VIEW_H * scale) / 2f)
        canvas.scale(scale, scale)
        canvas.translate(12f, 22f)
        val sleeping = mood == Mood.ASLEEP || mood == Mood.LOCKED
        val (shell, screen, deep) = if (sleeping) Triple(
            context.getColor(R.color.beacon_sleep_shell), context.getColor(R.color.beacon_sleep_screen), context.getColor(R.color.beacon_sleep_deep),
        ) else when (tone) {
            Tone.BLUE -> Triple(0xFF2D6CF6.toInt(), 0xFFDBE7FF.toInt(), 0xFF1A49B5.toInt())
            Tone.SUN -> Triple(0xFFFFC83D.toInt(), 0xFFFFF1C0.toInt(), 0xFFC8941A.toInt())
            Tone.CORAL -> Triple(0xFFFF6A4D.toInt(), 0xFFFFDAD1.toInt(), 0xFFC8442B.toInt())
            Tone.MINT -> Triple(0xFF2FD6A8.toInt(), 0xFFD6F7EC.toInt(), 0xFF14997A.toInt())
        }
        // Arms, hands, neck and foot in the deep shade.
        stroke.color = deep; stroke.strokeWidth = 5f
        path.reset(); path.moveTo(14f, 56f); path.cubicTo(2f, 58f, 0f, 70f, 6f, 78f); canvas.drawPath(path, stroke)
        path.reset()
        if (mood == Mood.WAVE) { path.moveTo(106f, 50f); path.cubicTo(120f, 44f, 122f, 30f, 116f, 20f) }
        else { path.moveTo(106f, 56f); path.cubicTo(118f, 58f, 120f, 70f, 114f, 78f) }
        canvas.drawPath(path, stroke)
        fill.color = deep
        canvas.drawCircle(6f, 78f, 6f, fill)
        if (mood == Mood.WAVE) canvas.drawCircle(116f, 20f, 6f, fill) else canvas.drawCircle(114f, 78f, 6f, fill)
        canvas.drawRect(52f, 82f, 68f, 96f, fill)
        rect.set(36f, 94f, 84f, 104f); canvas.drawRoundRect(rect, 5f, 5f, fill)
        // The monitor and its screen.
        fill.color = shell; rect.set(10f, 8f, 110f, 86f); canvas.drawRoundRect(rect, 18f, 18f, fill)
        fill.color = screen; rect.set(19f, 17f, 101f, 77f); canvas.drawRoundRect(rect, 11f, 11f, fill)
        // The face.
        fill.color = FACE; stroke.color = FACE; stroke.strokeWidth = 3.6f
        when (mood) {
            Mood.ASLEEP -> {
                path.reset(); path.moveTo(38f, 46f); path.rQuadTo(8f, 6f, 16f, 0f); path.moveTo(66f, 46f); path.rQuadTo(8f, 6f, 16f, 0f)
                canvas.drawPath(path, stroke)
                rect.set(60f - 3.6f, 60f - 2.8f, 60f + 3.6f, 60f + 2.8f); canvas.drawOval(rect, fill)
            }
            Mood.LOCKED -> {
                path.reset()
                path.moveTo(40f, 38f); path.rLineTo(10f, 10f); path.moveTo(50f, 38f); path.rLineTo(-10f, 10f)
                path.moveTo(70f, 38f); path.rLineTo(10f, 10f); path.moveTo(80f, 38f); path.rLineTo(-10f, 10f)
                path.moveTo(50f, 62f); path.rLineTo(20f, 0f)
                canvas.drawPath(path, stroke)
            }
            else -> {
                val wow = mood == Mood.WOW
                val rx = if (wow) 6f else 4.8f
                val ry = if (wow) 8f else 6.6f
                rect.set(46f - rx, 44f - ry, 46f + rx, 44f + ry); canvas.drawOval(rect, fill)
                rect.set(74f - rx, 44f - ry, 74f + rx, 44f + ry); canvas.drawOval(rect, fill)
                if (wow) { rect.set(55f, 56f, 65f, 68f); canvas.drawOval(rect, fill) }
                else { path.reset(); path.moveTo(50f, 56f); path.quadTo(60f, 66f, 70f, 56f); canvas.drawPath(path, stroke) }
                fill.color = shell; fill.alpha = 102
                canvas.drawCircle(35f, 57f, 5.5f, fill); canvas.drawCircle(85f, 57f, 5.5f, fill)
                fill.alpha = 255
            }
        }
        if (!sleeping) {
            val arc = context.getColor(R.color.beacon_arc)
            fill.color = arc; canvas.drawCircle(113f, 7f, 3.6f, fill)
            stroke.color = arc; stroke.strokeWidth = 4.5f
            rect.set(103f, -3f, 123f, 17f); canvas.drawArc(rect, -90f, 90f, false, stroke)
            rect.set(93f, -13f, 133f, 27f); canvas.drawArc(rect, -90f, 90f, false, stroke)
        }
        if (mood == Mood.ASLEEP) {
            stroke.color = deep; stroke.strokeWidth = 4f
            path.reset()
            path.moveTo(96f, 6f); path.rLineTo(10f, 0f); path.rLineTo(-10f, 12f); path.rLineTo(10f, 0f)
            path.moveTo(110f, -10f); path.rLineTo(7f, 0f); path.rLineTo(-7f, 8f); path.rLineTo(7f, 0f)
            canvas.drawPath(path, stroke)
        }
        canvas.restore()
    }

    companion object {
        private const val VIEW_W = 144f
        private const val VIEW_H = 150f
        private const val FACE = 0xFF1D1E24.toInt()

        /** The same stable colour per computer as the web workspace's toneFor(machine.id), so the phone matches its tile there. */
        fun toneFor(id: String): Tone {
            var sum = 0
            for (letter in id) sum = (sum + letter.code) % 997
            return Tone.values()[sum % 4]
        }
    }
}

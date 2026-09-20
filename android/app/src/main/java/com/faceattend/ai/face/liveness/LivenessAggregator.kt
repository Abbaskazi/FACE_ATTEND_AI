package com.faceattend.ai.face.liveness

import kotlin.math.ceil

enum class LivenessDecision { LIVE, SPOOF }

data class LivenessAggregation(
    val frameCount: Int,
    val progressPercent: Int,
    val medianScore: Float,
    val liveFrameCount: Int,
    val decision: LivenessDecision?,
)

/**
 * Aggregates independent frame scores. A decision is impossible until the
 * complete valid-frame window has been evaluated; progress therefore reflects
 * actual model evaluations rather than elapsed time.
 */
class LivenessAggregator(
    private val requiredFrames: Int = REQUIRED_LIVENESS_FRAMES,
    private val liveThreshold: Float = LIVENESS_SCORE_THRESHOLD,
    private val minimumLiveFraction: Float = MINIMUM_LIVE_FRAME_FRACTION,
) {
    private val scores = ArrayList<Float>(requiredFrames)

    val frameCount: Int get() = scores.size

    fun reset() = scores.clear()

    fun add(score: Float): LivenessAggregation {
        require(score.isFinite() && score in 0f..1f) { "Liveness score must be in [0, 1]" }
        if (scores.size < requiredFrames) scores += score

        val sorted = scores.sorted()
        val median = if (sorted.size % 2 == 1) {
            sorted[sorted.size / 2]
        } else {
            (sorted[sorted.size / 2 - 1] + sorted[sorted.size / 2]) / 2f
        }
        val liveFrames = scores.count { it >= liveThreshold }
        val complete = scores.size == requiredFrames
        val decision = if (!complete) {
            null
        } else if (median >= liveThreshold &&
            liveFrames >= ceil(requiredFrames * minimumLiveFraction).toInt()
        ) {
            LivenessDecision.LIVE
        } else {
            LivenessDecision.SPOOF
        }
        return LivenessAggregation(
            frameCount = scores.size,
            progressPercent = (scores.size * 100 / requiredFrames).coerceAtMost(100),
            medianScore = median,
            liveFrameCount = liveFrames,
            decision = decision,
        )
    }

    companion object {
        const val REQUIRED_LIVENESS_FRAMES = 20
        const val LIVENESS_SCORE_THRESHOLD = 0.80f
        const val MINIMUM_LIVE_FRAME_FRACTION = 0.75f
    }
}

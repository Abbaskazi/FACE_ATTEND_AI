package com.faceattend.ai.face.liveness

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LivenessAggregatorTest {
    @Test
    fun progressIsBasedOnEvaluatedFramesAndLiveRequiresTemporalAgreement() {
        val aggregator = LivenessAggregator()

        repeat(19) { index ->
            val result = aggregator.add(0.95f)
            assertEquals((index + 1) * 5, result.progressPercent)
            assertNull(result.decision)
        }
        val result = aggregator.add(0.95f)

        assertEquals(20, result.frameCount)
        assertEquals(100, result.progressPercent)
        assertEquals(LivenessDecision.LIVE, result.decision)
        assertTrue(result.medianScore >= 0.80f)
    }

    @Test
    fun spoofWindowFailsWhenMedianOrLiveFrameFractionIsInsufficient() {
        val aggregator = LivenessAggregator()

        repeat(6) { aggregator.add(0.10f) }
        repeat(14) { aggregator.add(0.95f) }

        val result = aggregator.add(0.10f)
        assertEquals(LivenessDecision.SPOOF, result.decision)
        assertEquals(20, result.frameCount)
    }

    @Test
    fun resetStartsAFreshFrameWindow() {
        val aggregator = LivenessAggregator()
        repeat(4) { aggregator.add(0.9f) }

        aggregator.reset()

        val result = aggregator.add(0.9f)
        assertEquals(1, result.frameCount)
        assertEquals(5, result.progressPercent)
        assertNull(result.decision)
    }
}

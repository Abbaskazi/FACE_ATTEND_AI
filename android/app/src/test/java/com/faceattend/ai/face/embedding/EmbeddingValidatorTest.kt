package com.faceattend.ai.face.embedding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmbeddingValidatorTest {
    @Test
    fun l2NormalizationProducesUnitNorm() {
        val raw = FloatArray(EMBEDDING_DIMENSION) { index -> (index + 1).toFloat() }
        val normalized = EmbeddingNormalizer.l2Normalize(raw)

        assertEquals(1.0f, EmbeddingValidator.l2Norm(normalized), 0.001f)
        assertTrue(normalized.all(Float::isFinite))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsWrongOutputDimension() {
        EmbeddingValidator.validateRaw(FloatArray(EMBEDDING_DIMENSION - 1))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonFiniteOutput() {
        EmbeddingValidator.validateRaw(FloatArray(EMBEDDING_DIMENSION) { Float.NaN })
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsZeroVector() {
        EmbeddingNormalizer.l2Normalize(FloatArray(EMBEDDING_DIMENSION))
    }
}

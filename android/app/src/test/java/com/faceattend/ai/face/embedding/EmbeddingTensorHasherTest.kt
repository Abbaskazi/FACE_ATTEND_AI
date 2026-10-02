package com.faceattend.ai.face.embedding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class EmbeddingTensorHasherTest {
    @Test
    fun sameNchwFloat32ValuesProduceTheSameTensorSha() {
        val input = FloatArray(3 * 112 * 112) { index -> (index % 257) / 257f }
        assertEquals(EmbeddingTensorHasher.sha256(input), EmbeddingTensorHasher.sha256(input.copyOf()))
    }

    @Test
    fun changingOneTensorValueChangesTheTensorSha() {
        val original = FloatArray(3 * 112 * 112)
        val changed = original.copyOf().also { it[3 * 112 * 50 + 17] = 0.000001f }
        assertNotEquals(EmbeddingTensorHasher.sha256(original), EmbeddingTensorHasher.sha256(changed))
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNonNchw112Tensor() {
        EmbeddingTensorHasher.sha256(FloatArray(112 * 112 * 3 - 1))
    }
}

package com.faceattend.ai.face.embedding

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class EmbeddingProvenanceHasherTest {
    @Test
    fun sameFloat32ValuesProduceTheSameHash() {
        val values = FloatArray(EMBEDDING_DIMENSION) { index -> index.toFloat() / 512f }

        assertEquals(
            EmbeddingProvenanceHasher.sha256(values),
            EmbeddingProvenanceHasher.sha256(values.copyOf()),
        )
    }

    @Test
    fun changingOneFloat32ValueChangesTheHash() {
        val original = FloatArray(EMBEDDING_DIMENSION) { index -> index.toFloat() / 512f }
        val changed = original.copyOf().also { it[127] = it[127] + 0.000001f }

        assertNotEquals(
            EmbeddingProvenanceHasher.sha256(original),
            EmbeddingProvenanceHasher.sha256(changed),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsWrongDimension() {
        EmbeddingProvenanceHasher.sha256(FloatArray(EMBEDDING_DIMENSION - 1))
    }
}

package com.faceattend.ai.face.embedding

object EmbeddingNormalizer {
    fun l2Normalize(raw: FloatArray): FloatArray {
        EmbeddingValidator.validateRaw(raw)
        val norm = EmbeddingValidator.l2Norm(raw)
        require(norm > 1.0e-12f) { "Cannot normalize a zero-length embedding" }
        val normalized = FloatArray(raw.size) { index -> raw[index] / norm }
        EmbeddingValidator.validateNormalized(normalized)
        return normalized
    }
}

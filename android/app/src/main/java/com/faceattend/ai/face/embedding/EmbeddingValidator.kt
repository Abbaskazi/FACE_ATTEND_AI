package com.faceattend.ai.face.embedding

object EmbeddingValidator {
    private const val NORMALIZED_NORM_TOLERANCE = 0.001f
    private const val MINIMUM_NORM = 1.0e-12f

    fun validateRaw(values: FloatArray) {
        require(values.size == EMBEDDING_DIMENSION) {
            "Model output must contain exactly $EMBEDDING_DIMENSION values"
        }
        require(values.all(Float::isFinite)) {
            "Model output contains NaN or infinity"
        }
    }

    fun validateNormalized(values: FloatArray) {
        validateRaw(values)
        val norm = l2Norm(values)
        require(norm > MINIMUM_NORM) { "Embedding norm is too close to zero" }
        require(kotlin.math.abs(norm - 1.0f) <= NORMALIZED_NORM_TOLERANCE) {
            "Normalized embedding norm is $norm, expected approximately 1.0"
        }
    }

    fun l2Norm(values: FloatArray): Float {
        var sum = 0.0
        for (value in values) {
            require(value.isFinite()) { "Embedding contains NaN or infinity" }
            sum += value.toDouble() * value.toDouble()
        }
        return kotlin.math.sqrt(sum).toFloat()
    }
}

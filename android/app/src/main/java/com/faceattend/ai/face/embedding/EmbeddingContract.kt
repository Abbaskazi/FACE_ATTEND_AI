package com.faceattend.ai.face.embedding

const val EMBEDDING_DIMENSION = 512
const val MODEL_INPUT_WIDTH = 112
const val MODEL_INPUT_HEIGHT = 112
const val MODEL_ASSET_NAME = "glintr100.onnx"
const val VERIFIED_MODEL_SHA256 = "4ab1d6435d639628a6f3e5008dd4f929edf4c4124b1a7169e1048f9fef534cdf"
const val MODEL_VERSION = VERIFIED_MODEL_SHA256

data class RgbImage(
    val width: Int,
    val height: Int,
    val rgb: ByteArray,
) {
    init {
        require(rgb.size == width * height * 3) {
            "RGB image buffer must contain width * height * 3 bytes"
        }
    }
}

data class FaceEmbedding(val values: FloatArray) {
    init {
        require(values.size == EMBEDDING_DIMENSION) {
            "Face embedding must contain exactly $EMBEDDING_DIMENSION values"
        }
    }
}

data class FaceEmbeddingInference(
    val embedding: FaceEmbedding,
    /** Exact NCHW Float32 values supplied to the embedding model. */
    val inputTensor: FloatArray,
)

interface FaceEmbeddingModel : AutoCloseable {
    fun embed(face: RgbImage): FaceEmbedding

    /**
     * Returns the embedding and the exact preprocessed tensor values together.
     * Implementations that do not expose their inference internals retain the
     * same deterministic preprocessing contract through this default path.
     */
    fun embedWithInput(face: RgbImage): FaceEmbeddingInference {
        val input = EmbeddingPreprocessor.toNchwFloat32(face)
        return FaceEmbeddingInference(embed(face), input)
    }
}

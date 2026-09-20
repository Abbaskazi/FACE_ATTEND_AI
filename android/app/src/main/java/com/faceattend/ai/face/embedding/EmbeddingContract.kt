package com.faceattend.ai.face.embedding

const val EMBEDDING_DIMENSION = 512
const val MODEL_INPUT_WIDTH = 112
const val MODEL_INPUT_HEIGHT = 112
const val MODEL_ASSET_NAME = "w600k_mbf.onnx"
const val VERIFIED_MODEL_SHA256 = "9cc6e4a75f0e2bf0b1aed94578f144d15175f357bdc05e815e5c4a02b319eb4f"
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

interface FaceEmbeddingModel : AutoCloseable {
    fun embed(face: RgbImage): FaceEmbedding
}

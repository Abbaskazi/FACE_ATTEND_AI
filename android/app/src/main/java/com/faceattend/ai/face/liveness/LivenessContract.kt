package com.faceattend.ai.face.liveness

const val LIVENESS_MODEL_ASSET_NAME = "minifasnet_v2.onnx"
const val LIVENESS_MODEL_INPUT_SIZE = 80
const val LIVENESS_MODEL_OUTPUT_CLASSES = 3
const val LIVENESS_LIVE_CLASS_INDEX = 1
const val VERIFIED_LIVENESS_MODEL_SHA256 =
    "d7b3cd9ba8a7ceb13baa8c4720902e27ca3112eff52f926c08804af6b6eecc7b"
const val LIVENESS_MODEL_VERSION = VERIFIED_LIVENESS_MODEL_SHA256

/** BGR pixels in row-major HWC order, matching the MiniFASNet training pipeline. */
data class BgrImage(
    val width: Int,
    val height: Int,
    val bgr: ByteArray,
) {
    init {
        require(bgr.size == width * height * 3) {
            "BGR image buffer must contain width * height * 3 bytes"
        }
    }
}

data class LivenessPrediction(
    val logits: FloatArray,
    val liveScore: Float,
)

interface FaceLivenessModel : AutoCloseable {
    /** Returns raw logits and the softmax probability for upstream class-1 (live). */
    fun predict(face: BgrImage): LivenessPrediction
}

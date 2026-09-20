package com.faceattend.ai.face.liveness

object LivenessPreprocessor {
    fun toNchwFloat32(face: BgrImage): FloatArray {
        require(face.width == LIVENESS_MODEL_INPUT_SIZE && face.height == LIVENESS_MODEL_INPUT_SIZE) {
            "Liveness input must be exactly ${LIVENESS_MODEL_INPUT_SIZE}x${LIVENESS_MODEL_INPUT_SIZE}"
        }

        val planeSize = LIVENESS_MODEL_INPUT_SIZE * LIVENESS_MODEL_INPUT_SIZE
        val output = FloatArray(3 * planeSize)
        for (y in 0 until LIVENESS_MODEL_INPUT_SIZE) {
            for (x in 0 until LIVENESS_MODEL_INPUT_SIZE) {
                val pixelIndex = (y * LIVENESS_MODEL_INPUT_SIZE + x) * 3
                val spatialIndex = y * LIVENESS_MODEL_INPUT_SIZE + x
                for (channel in 0 until 3) {
                    output[channel * planeSize + spatialIndex] =
                        (face.bgr[pixelIndex + channel].toInt() and 0xFF).toFloat()
                }
            }
        }
        return output
    }
}

package com.faceattend.ai.face.embedding

object EmbeddingPreprocessor {
    private const val CHANNELS = 3
    private const val PIXEL_CENTER = 127.5f
    private const val PIXEL_SCALE = 127.5f

    fun toNchwFloat32(face: RgbImage): FloatArray {
        require(face.width == MODEL_INPUT_WIDTH && face.height == MODEL_INPUT_HEIGHT) {
            "Face input must be exactly ${MODEL_INPUT_WIDTH}x${MODEL_INPUT_HEIGHT}"
        }

        val planeSize = MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT
        val output = FloatArray(CHANNELS * planeSize)
        for (y in 0 until MODEL_INPUT_HEIGHT) {
            for (x in 0 until MODEL_INPUT_WIDTH) {
                val pixelIndex = (y * MODEL_INPUT_WIDTH + x) * CHANNELS
                val spatialIndex = y * MODEL_INPUT_WIDTH + x
                for (channel in 0 until CHANNELS) {
                    val pixel = face.rgb[pixelIndex + channel].toInt() and 0xFF
                    output[channel * planeSize + spatialIndex] =
                        (pixel - PIXEL_CENTER) / PIXEL_SCALE
                }
            }
        }
        return output
    }
}

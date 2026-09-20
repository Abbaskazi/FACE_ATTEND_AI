package com.faceattend.ai.face.liveness

import org.junit.Assert.assertEquals
import org.junit.Test

class LivenessPreprocessorTest {
    @Test
    fun convertsBgrHwcToRawNchw() {
        val pixels = ByteArray(LIVENESS_MODEL_INPUT_SIZE * LIVENESS_MODEL_INPUT_SIZE * 3)
        pixels[0] = 0
        pixels[1] = 127
        pixels[2] = 255.toByte()

        val output = LivenessPreprocessor.toNchwFloat32(
            BgrImage(LIVENESS_MODEL_INPUT_SIZE, LIVENESS_MODEL_INPUT_SIZE, pixels),
        )
        val plane = LIVENESS_MODEL_INPUT_SIZE * LIVENESS_MODEL_INPUT_SIZE

        assertEquals(0f, output[0], 0.0001f)
        assertEquals(127f, output[plane], 0.0001f)
        assertEquals(255f, output[plane * 2], 0.0001f)
    }
}

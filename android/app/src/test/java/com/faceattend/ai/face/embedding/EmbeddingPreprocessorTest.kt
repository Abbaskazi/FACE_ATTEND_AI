package com.faceattend.ai.face.embedding

import org.junit.Assert.assertEquals
import org.junit.Test

class EmbeddingPreprocessorTest {
    @Test
    fun convertsRgbPixelsToNchwWithExactNormalization() {
        val rgb = ByteArray(MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT * 3)
        rgb[0] = 0
        rgb[1] = 127
        rgb[2] = 255.toByte()
        val lastPixel = (MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT - 1) * 3
        rgb[lastPixel] = 255.toByte()
        rgb[lastPixel + 1] = 0
        rgb[lastPixel + 2] = 127

        val output = EmbeddingPreprocessor.toNchwFloat32(
            RgbImage(MODEL_INPUT_WIDTH, MODEL_INPUT_HEIGHT, rgb),
        )
        val plane = MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT

        assertEquals(3 * plane, output.size)
        assertEquals(-1.0f, output[0], 0.00001f)
        assertEquals((127f - 127.5f) / 127.5f, output[plane], 0.00001f)
        assertEquals(1.0f, output[2 * plane], 0.00001f)
        assertEquals(1.0f, output[plane - 1], 0.00001f)
        assertEquals((127f - 127.5f) / 127.5f, output[2 * plane + plane - 1], 0.00001f)
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsNon112Input() {
        EmbeddingPreprocessor.toNchwFloat32(RgbImage(10, 10, ByteArray(10 * 10 * 3)))
    }
}

package com.faceattend.ai.face.liveness

import org.junit.Assert.assertArrayEquals
import org.junit.Test

class FaceLivenessCropperTest {
    @Test
    fun convertsAndroidArgbToModelBgrOrder() {
        val argb = intArrayOf(0xFF112233.toInt())

        assertArrayEquals(
            byteArrayOf(0x33, 0x22, 0x11),
            FaceLivenessCropper.argbToBgr(argb),
        )
    }
}

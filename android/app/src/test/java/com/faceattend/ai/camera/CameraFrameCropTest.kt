package com.faceattend.ai.camera

import org.junit.Assert.assertEquals
import org.junit.Test

class CameraFrameCropTest {
    @Test
    fun preservesCropRectInRawImageCoordinates() {
        assertEquals(
            CameraCropRect(10, 20, 110, 220),
            CameraFrameCrop.validate(320, 240, 10, 20, 110, 220),
        )
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsCropOutsideImage() {
        CameraFrameCrop.validate(320, 240, 0, 0, 321, 240)
    }
}

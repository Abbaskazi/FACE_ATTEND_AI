package com.faceattend.ai.face.alignment

import org.junit.Assert.assertEquals
import org.junit.Test

class BitmapOrientationTest {
    @Test
    fun normalizesCameraRotationWithoutChangingCoordinateConvention() {
        assertEquals(0, BitmapOrientation.normalizeDegrees(360))
        assertEquals(270, BitmapOrientation.normalizeDegrees(-90))
        assertEquals(90, BitmapOrientation.normalizeDegrees(450))
    }
}

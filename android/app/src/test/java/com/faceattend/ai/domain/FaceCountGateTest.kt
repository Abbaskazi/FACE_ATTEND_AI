package com.faceattend.ai.domain

import org.junit.Assert.assertEquals
import org.junit.Test

class FaceCountGateTest {
    @Test
    fun noFacesRejectsScan() {
        assertEquals(FaceGateStatus.NO_FACE, FaceCountGate.statusFor(0))
        assertEquals(FaceGateStatus.NO_FACE, FaceCountGate.statusFor(-1))
    }

    @Test
    fun exactlyOneFaceIsAcceptedForNextStage() {
        assertEquals(FaceGateStatus.SINGLE_FACE, FaceCountGate.statusFor(1))
    }

    @Test
    fun multipleFacesRejectScan() {
        assertEquals(FaceGateStatus.MULTIPLE_FACES, FaceCountGate.statusFor(2))
        assertEquals(FaceGateStatus.MULTIPLE_FACES, FaceCountGate.statusFor(10))
    }
}

package com.faceattend.ai.domain

enum class FaceGateStatus {
    NO_FACE,
    SINGLE_FACE,
    MULTIPLE_FACES,
}

object FaceCountGate {
    fun statusFor(faceCount: Int): FaceGateStatus = when {
        faceCount <= 0 -> FaceGateStatus.NO_FACE
        faceCount == 1 -> FaceGateStatus.SINGLE_FACE
        else -> FaceGateStatus.MULTIPLE_FACES
    }
}

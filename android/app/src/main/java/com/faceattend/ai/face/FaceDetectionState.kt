package com.faceattend.ai.face

import com.faceattend.ai.domain.FaceGateStatus

enum class LivenessStatus {
    IDLE,
    COLLECTING,
    PASSED,
    FAILED,
}

data class FaceDetectionState(
    val status: FaceGateStatus = FaceGateStatus.NO_FACE,
    val errorMessage: String? = null,
    val embeddingReady: Boolean = false,
    val alignmentVersion: String? = null,
    val livenessStatus: LivenessStatus = LivenessStatus.IDLE,
    val livenessProgress: Int = 0,
    val livenessScore: Float? = null,
    val trackingId: Int? = null,
)

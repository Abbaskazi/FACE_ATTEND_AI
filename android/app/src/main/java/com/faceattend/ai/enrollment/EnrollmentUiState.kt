package com.faceattend.ai.enrollment

import com.faceattend.ai.domain.FaceGateStatus
import com.faceattend.ai.face.FaceDetectionState

fun FaceDetectionState.enrollmentMessage(): String = when {
    errorMessage != null -> errorMessage
    status == FaceGateStatus.MULTIPLE_FACES -> "Only one person can enroll"
    status == FaceGateStatus.NO_FACE -> "Position your face inside the frame"
    embeddingReady -> "Face detected — ready to enroll"
    else -> "Face detected"
}

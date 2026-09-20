package com.faceattend.ai.face.alignment

/**
 * ML Kit names eye and mouth landmarks from the subject's perspective.
 * CameraX ImageAnalysis frames are not front-camera mirrored, so the subject's
 * right side is image-left and the subject's left side is image-right.
 */
data class SubjectFivePointLandmarks(
    val subjectLeftEye: AlignmentPoint,
    val subjectRightEye: AlignmentPoint,
    val noseBase: AlignmentPoint,
    val subjectLeftMouth: AlignmentPoint,
    val subjectRightMouth: AlignmentPoint,
)

object ArcFaceLandmarkOrder {
    /** Returns points in the image-left-to-image-right ArcFace template order. */
    fun inImageOrder(landmarks: SubjectFivePointLandmarks): List<AlignmentPoint> = listOf(
        landmarks.subjectRightEye,
        landmarks.subjectLeftEye,
        landmarks.noseBase,
        landmarks.subjectRightMouth,
        landmarks.subjectLeftMouth,
    )
}

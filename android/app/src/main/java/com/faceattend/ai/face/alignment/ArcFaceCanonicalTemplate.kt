package com.faceattend.ai.face.alignment

/**
 * The standard 112x112 ArcFace/InsightFace five-point template.
 *
 * Points are in image order: image-left eye, image-right eye, nose base,
 * image-left mouth corner, image-right mouth corner.
 */
object ArcFaceCanonicalTemplate {
    const val WIDTH = 112
    const val HEIGHT = 112

    val points: List<AlignmentPoint> = listOf(
        AlignmentPoint(38.2946f, 51.6963f),
        AlignmentPoint(73.5318f, 51.5014f),
        AlignmentPoint(56.0252f, 71.7366f),
        AlignmentPoint(41.5493f, 92.3655f),
        AlignmentPoint(70.7299f, 92.2041f),
    )
}

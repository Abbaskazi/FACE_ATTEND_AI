package com.faceattend.ai.face.alignment

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.PointF
import android.util.Log
import com.faceattend.ai.BuildConfig
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceLandmark

private const val RAW_LANDMARK_LOG_TAG = "RAW_LANDMARK_TEST"
private const val RAW_LANDMARK_LOG_PREFIX = "RAW_LANDMARK_HANDNESS_TEST "

/**
 * Production five-point ArcFace alignment.
 *
 * The analyzer supplies the same upright bitmap to ML Kit and this component,
 * so landmark coordinates are direct bitmap pixel coordinates. Preview
 * mirroring is deliberately not applied: CameraX's front-camera preview may
 * be mirrored for the user, but the inference bitmap is not.
 * `analysisFrameIsMirrored` exists only for a caller that explicitly supplies
 * a mirrored analysis bitmap.
 */
class ArcFaceAligner(
    private val analysisFrameIsMirrored: Boolean = false,
) : FaceAlignment {
    override val version: String = "arcface-five-point-v1"

    override fun align(frame: Bitmap, face: Face, rotationDegrees: Int): AlignedFace {
        val oriented = BitmapOrientation.rotate(frame, rotationDegrees)
        val renderSource = if (analysisFrameIsMirrored) mirrorHorizontally(oriented) else oriented

        try {
            val subjectLandmarks = SubjectFivePointLandmarks(
                subjectLeftEye = face.requiredLandmark(FaceLandmark.LEFT_EYE),
                subjectRightEye = face.requiredLandmark(FaceLandmark.RIGHT_EYE),
                noseBase = face.requiredLandmark(FaceLandmark.NOSE_BASE),
                subjectLeftMouth = face.requiredLandmark(FaceLandmark.MOUTH_LEFT),
                subjectRightMouth = face.requiredLandmark(FaceLandmark.MOUTH_RIGHT),
            )
            if (BuildConfig.DEBUG) {
                Log.d(
                    RAW_LANDMARK_LOG_TAG,
                    RAW_LANDMARK_LOG_PREFIX +
                        "bitmap=${oriented.width}x${oriented.height} " +
                        "rotation=$rotationDegrees " +
                        "MLKIT_LEFT_EYE=${subjectLandmarks.subjectLeftEye} " +
                        "MLKIT_RIGHT_EYE=${subjectLandmarks.subjectRightEye} " +
                        "MLKIT_MOUTH_LEFT=${subjectLandmarks.subjectLeftMouth} " +
                        "MLKIT_MOUTH_RIGHT=${subjectLandmarks.subjectRightMouth} " +
                        "MLKIT_NOSE_BASE=${subjectLandmarks.noseBase} " +
                        "EYE_DELTA_X=${subjectLandmarks.subjectRightEye.x - subjectLandmarks.subjectLeftEye.x} " +
                        "MOUTH_DELTA_X=${subjectLandmarks.subjectRightMouth.x - subjectLandmarks.subjectLeftMouth.x}",
                )
            }
            val imageOrderedLandmarks = ArcFaceLandmarkOrder.inImageOrder(subjectLandmarks)
                .map { point ->
                    if (analysisFrameIsMirrored) {
                        AlignmentPoint(oriented.width - point.x, point.y)
                    } else {
                        point
                    }
                }
            if (BuildConfig.DEBUG) {
                Log.d(
                    RAW_LANDMARK_LOG_TAG,
                    RAW_LANDMARK_LOG_PREFIX +
                        "ORDERED_LEFT_EYE=${imageOrderedLandmarks[0]} " +
                        "ORDERED_RIGHT_EYE=${imageOrderedLandmarks[1]} " +
                        "ORDERED_NOSE=${imageOrderedLandmarks[2]} " +
                        "ORDERED_LEFT_MOUTH=${imageOrderedLandmarks[3]} " +
                        "ORDERED_RIGHT_MOUTH=${imageOrderedLandmarks[4]}",
                )
            }
            imageOrderedLandmarks.forEach { point ->
                require(point.x >= 0f && point.x <= renderSource.width) {
                    "Landmark x is outside the analysis frame: point=$point, " +
                        "frame=${frame.width}x${frame.height}, " +
                        "render=${renderSource.width}x${renderSource.height}, " +
                        "oriented=${oriented.width}x${oriented.height}, rotation=$rotationDegrees"
                }
                require(point.y >= 0f && point.y <= renderSource.height) {
                    "Landmark y is outside the analysis frame: point=$point, " +
                        "frame=${frame.width}x${frame.height}, " +
                        "render=${renderSource.width}x${renderSource.height}, " +
                        "oriented=${oriented.width}x${oriented.height}, rotation=$rotationDegrees"
                }
            }

            val transform = SimilarityTransform.estimate(
                source = imageOrderedLandmarks,
                destination = ArcFaceCanonicalTemplate.points,
            )
            val output = Bitmap.createBitmap(
                ArcFaceCanonicalTemplate.WIDTH,
                ArcFaceCanonicalTemplate.HEIGHT,
                Bitmap.Config.ARGB_8888,
            )
            output.eraseColor(Color.BLACK)
            val matrix = Matrix().apply {
                setValues(
                    floatArrayOf(
                        transform.a, -transform.b, transform.translateX,
                        transform.b, transform.a, transform.translateY,
                        0f, 0f, 1f,
                    ),
                )
            }
            Canvas(output).drawBitmap(
                renderSource,
                matrix,
                Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG),
            )
            return AlignedFace(
                bitmap = output,
                alignmentVersion = version,
                sourceLandmarks = imageOrderedLandmarks,
                targetLandmarks = ArcFaceCanonicalTemplate.points,
            )
        } finally {
            if (renderSource !== oriented) renderSource.recycle()
            if (oriented !== frame) oriented.recycle()
        }
    }

    private fun mirrorHorizontally(bitmap: Bitmap): Bitmap = Bitmap.createBitmap(
        bitmap,
        0,
        0,
        bitmap.width,
        bitmap.height,
        Matrix().apply {
            setScale(-1f, 1f)
            postTranslate(bitmap.width.toFloat(), 0f)
        },
        true,
    )

    private fun Face.requiredLandmark(type: Int): AlignmentPoint {
        val position: PointF = getLandmark(type)?.position
            ?: throw IllegalArgumentException("Required facial landmark is unavailable: $type")
        return AlignmentPoint(position.x, position.y)
    }
}

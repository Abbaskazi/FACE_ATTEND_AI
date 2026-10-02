package com.faceattend.ai.diagnostics

import android.graphics.Bitmap
import com.faceattend.ai.face.alignment.AlignmentPoint

data class DiagnosticRect(
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
)

/**
 * Ephemeral handoff from the analyzer to the debug-only local artifact store.
 * The bitmap and tensor are consumed synchronously and are never serialized
 * into recognition logs or sent to Supabase.
 */
data class EnrollmentInputDiagnosticCapture(
    val timestampEpochMs: Long,
    val employeeCode: String?,
    val sessionGeneration: String?,
    val cameraFacing: String,
    val sourceImageWidth: Int,
    val sourceImageHeight: Int,
    val cropRect: DiagnosticRect,
    val rotationDegrees: Int,
    val analysisImageWidth: Int,
    val analysisImageHeight: Int,
    val faceBoundingBox: DiagnosticRect,
    val sourceLandmarks: List<AlignmentPoint>,
    val targetLandmarks: List<AlignmentPoint>,
    val alignedBitmap: Bitmap,
    val modelName: String,
    val modelVersion: String,
    val tensorShape: List<Int>,
    val preprocessingFormula: String,
    val channelOrder: String,
    val embeddingDimension: Int,
    val embeddingL2Norm: Float,
    val embeddingProvenanceSha256: String,
    val inputTensor: FloatArray,
)

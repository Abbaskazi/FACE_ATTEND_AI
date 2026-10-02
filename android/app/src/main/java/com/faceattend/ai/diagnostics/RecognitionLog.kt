package com.faceattend.ai.diagnostics

data class SelectedFaceDiagnostic(
    val trackingId: Int?,
    val left: Int,
    val top: Int,
    val right: Int,
    val bottom: Int,
)

enum class RecognitionOperation {
    ENROLLMENT,
    ENROLLMENT_INPUT_DIAGNOSTIC,
    ENROLLMENT_PROVENANCE,
    CHECK_IN,
    CHECK_OUT,
    FACE_RECOGNITION,
}

enum class RecognitionLogResult {
    SUCCESS,
    FAILED,
    UNKNOWN,
    AMBIGUOUS,
    ERROR,
}

/**
 * Local diagnostic metadata only. This type intentionally has no image, raw
 * embedding values, vector, token, or secret fields. Provenance fields contain
 * hashes and generation metadata only.
 */
data class RecognitionLog(
    val id: String,
    val timestampEpochMs: Long,
    val operation: RecognitionOperation,
    val result: RecognitionLogResult,
    val employeeId: String? = null,
    val employeeCode: String? = null,
    val employeeName: String? = null,
    val detectedFaceCount: Int? = null,
    val candidateCount: Int? = null,
    val selectedFace: SelectedFaceDiagnostic? = null,
    val topCandidate: String? = null,
    val topSimilarityScore: Double? = null,
    val secondSimilarityScore: Double? = null,
    val recognitionMargin: Double? = null,
    val threshold: Double? = null,
    val ambiguityMargin: Double? = null,
    val modelName: String? = null,
    val modelVersion: String? = null,
    val modelSha256: String? = null,
    val embeddingDimension: Int? = null,
    val embeddingGenerated: Boolean = false,
    val l2NormalizationSucceeded: Boolean? = null,
    val cameraStatus: String? = null,
    val faceDetectionStatus: String? = null,
    val errorCode: String? = null,
    val errorMessage: String? = null,
    val appVersion: String? = null,
    val deviceManufacturer: String? = null,
    val deviceModel: String? = null,
    val androidVersion: String? = null,
    val androidSdk: Int? = null,
    val processingDurationMs: Long? = null,
    val diagnosticInfo: String? = null,
    val provenanceStage: String? = null,
    val provenanceEmbeddingSha256: String? = null,
    val provenanceEmbeddingGeneration: String? = null,
    val provenanceSubmitGeneration: String? = null,
    val provenanceSessionTokenPresent: Boolean? = null,
    val provenanceHashMatchesReady: Boolean? = null,
    val provenanceGenerationMatchesReady: Boolean? = null,
    val enrollmentDiagnosticId: String? = null,
    val enrollmentDiagnosticImageSha256: String? = null,
    val enrollmentDiagnosticTensorSha256: String? = null,
)

const val MAX_RECOGNITION_LOGS = 500

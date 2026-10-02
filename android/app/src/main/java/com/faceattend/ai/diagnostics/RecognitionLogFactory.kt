package com.faceattend.ai.diagnostics

import android.os.Build
import android.os.SystemClock
import com.faceattend.ai.BuildConfig
import com.faceattend.ai.face.FaceDetectionState
import com.faceattend.ai.face.embedding.EMBEDDING_DIMENSION
import com.faceattend.ai.face.embedding.MODEL_ASSET_NAME
import com.faceattend.ai.face.embedding.MODEL_VERSION
import java.util.UUID

object RecognitionLogFactory {
    fun create(
        operation: RecognitionOperation,
        result: RecognitionLogResult,
        startedAtElapsedRealtime: Long,
        state: FaceDetectionState,
        embeddingGenerated: Boolean,
        employeeId: String? = null,
        employeeCode: String? = null,
        employeeName: String? = null,
        candidateCount: Int? = null,
        topCandidate: String? = null,
        topScore: Double? = null,
        secondScore: Double? = null,
        margin: Double? = null,
        threshold: Double? = null,
        ambiguityMargin: Double? = null,
        errorCode: String? = null,
        errorMessage: String? = null,
        diagnosticInfo: String? = null,
        enrollmentDiagnosticId: String? = null,
        enrollmentDiagnosticImageSha256: String? = null,
        enrollmentDiagnosticTensorSha256: String? = null,
    ): RecognitionLog = RecognitionLog(
        id = UUID.randomUUID().toString(),
        timestampEpochMs = System.currentTimeMillis(),
        operation = operation,
        result = result,
        employeeId = employeeId,
        employeeCode = employeeCode,
        employeeName = employeeName,
        detectedFaceCount = state.detectedFaceCount,
        candidateCount = candidateCount,
        selectedFace = state.selectedFace,
        topCandidate = topCandidate,
        topSimilarityScore = topScore,
        secondSimilarityScore = secondScore,
        recognitionMargin = margin,
        threshold = threshold,
        ambiguityMargin = ambiguityMargin,
        modelName = MODEL_ASSET_NAME,
        modelVersion = MODEL_VERSION,
        modelSha256 = MODEL_VERSION,
        embeddingDimension = EMBEDDING_DIMENSION,
        embeddingGenerated = embeddingGenerated,
        l2NormalizationSucceeded = embeddingGenerated,
        cameraStatus = if (state.errorMessage == null) "AVAILABLE" else "ERROR",
        faceDetectionStatus = state.status.name,
        errorCode = errorCode,
        errorMessage = sanitize(errorMessage),
        appVersion = BuildConfig.VERSION_NAME,
        deviceManufacturer = Build.MANUFACTURER,
        deviceModel = Build.MODEL,
        androidVersion = Build.VERSION.RELEASE,
        androidSdk = Build.VERSION.SDK_INT,
        processingDurationMs = (SystemClock.elapsedRealtime() - startedAtElapsedRealtime).coerceAtLeast(0L),
        diagnosticInfo = sanitize(diagnosticInfo),
        enrollmentDiagnosticId = enrollmentDiagnosticId,
        enrollmentDiagnosticImageSha256 = enrollmentDiagnosticImageSha256,
        enrollmentDiagnosticTensorSha256 = enrollmentDiagnosticTensorSha256,
    )

    fun createProvenance(
        event: EmbeddingProvenanceEvent,
        state: FaceDetectionState,
    ): RecognitionLog = create(
        operation = RecognitionOperation.ENROLLMENT_PROVENANCE,
        result = RecognitionLogResult.SUCCESS,
        startedAtElapsedRealtime = SystemClock.elapsedRealtime(),
        state = state,
        embeddingGenerated = true,
    ).copy(
        provenanceStage = event.stage.name,
        provenanceEmbeddingSha256 = event.embeddingSha256,
        provenanceEmbeddingGeneration = event.embeddingGeneration,
        provenanceSubmitGeneration = event.submitGeneration,
        provenanceSessionTokenPresent = event.sessionTokenPresent,
        provenanceHashMatchesReady = event.hashMatchesReady,
        provenanceGenerationMatchesReady = event.generationMatchesReady,
    )

    private fun sanitize(value: String?): String? = value
        ?.replace(
            Regex("(?i)(access_token|refresh_token|authorization|apikey|service[-_ ]role|password|embedding|vector|secret)\\s*[:=]\\s*[^,;\\s]+"),
            "$1=<redacted>",
        )
        ?.replace(Regex("[\\r\\n]+"), " ")
        ?.take(300)
        ?.ifBlank { null }
}

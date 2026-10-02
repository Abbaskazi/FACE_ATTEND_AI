package com.faceattend.ai.diagnostics

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object RecognitionLogFormatter {
    fun toText(logs: List<RecognitionLog>): String = buildString {
        appendLine("FaceAttend AI - Local Recognition Logs")
        appendLine("Entries: ${logs.size}")
        appendLine("No images or biometric vectors are included.")
        appendLine()
        logs.forEachIndexed { index, log ->
            appendLine("--- Log ${index + 1} ---")
            appendLine(toText(log))
        }
    }

    fun toText(log: RecognitionLog): String = buildString {
        field("ID", log.id)
        field("Timestamp", formatTimestamp(log.timestampEpochMs))
        field("Operation", log.operation.name)
        field("Result", log.result.name)
        field("Employee ID", log.employeeId)
        field("Employee code", log.employeeCode)
        field("Employee name", log.employeeName)
        field("Detected face count", log.detectedFaceCount)
        field("Candidate count", log.candidateCount)
        field("Selected face", log.selectedFace?.toString())
        field("Top candidate", log.topCandidate)
        field("Top score", log.topSimilarityScore)
        field("Second score", log.secondSimilarityScore)
        field("Recognition margin", log.recognitionMargin)
        field("Threshold", log.threshold)
        field("Ambiguity margin", log.ambiguityMargin)
        field("Model", log.modelName)
        field("Model version", log.modelVersion)
        field("Model SHA-256", log.modelSha256)
        field("Embedding dimension", log.embeddingDimension)
        field("Embedding generated", log.embeddingGenerated)
        field("L2 normalization succeeded", log.l2NormalizationSucceeded)
        field("Camera status", log.cameraStatus)
        field("Face detection status", log.faceDetectionStatus)
        field("Error code", log.errorCode)
        field("Error message", log.errorMessage)
        field("App version", log.appVersion)
        field("Device", listOfNotNull(log.deviceManufacturer, log.deviceModel).joinToString(" ").ifBlank { null })
        field("Android", log.androidVersion)
        field("Android SDK", log.androidSdk)
        field("Processing duration (ms)", log.processingDurationMs)
        field("Diagnostic info", log.diagnosticInfo)
        field("Provenance stage", log.provenanceStage)
        field("Provenance SHA-256", log.provenanceEmbeddingSha256)
        field("Embedding generation", log.provenanceEmbeddingGeneration)
        field("Submit generation", log.provenanceSubmitGeneration)
        field("Session token present", log.provenanceSessionTokenPresent)
        field("Hash matches ready", log.provenanceHashMatchesReady)
        field("Generation matches ready", log.provenanceGenerationMatchesReady)
        field("Enrollment diagnostic ID", log.enrollmentDiagnosticId)
        field("Enrollment diagnostic image SHA-256", log.enrollmentDiagnosticImageSha256)
        field("Enrollment diagnostic tensor SHA-256", log.enrollmentDiagnosticTensorSha256)
    }

    private fun StringBuilder.field(name: String, value: Any?) {
        append(name).append(": ").append(value ?: "—").append('\n')
    }

    private fun formatTimestamp(epochMs: Long): String = SimpleDateFormat(
        "yyyy-MM-dd HH:mm:ss.SSS z",
        Locale.US,
    ).format(Date(epochMs))
}

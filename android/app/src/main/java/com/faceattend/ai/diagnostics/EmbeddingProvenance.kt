package com.faceattend.ai.diagnostics

import android.util.Log
import com.faceattend.ai.face.FaceDetectionState
enum class EmbeddingProvenanceStage {
    EMBEDDING_READY,
    SUBMIT_PREPARED,
    API_PAYLOAD,
}

data class EmbeddingProvenanceEvent(
    val stage: EmbeddingProvenanceStage,
    val embeddingSha256: String,
    val embeddingGeneration: String?,
    val submitGeneration: String? = null,
    val sessionTokenPresent: Boolean,
    val hashMatchesReady: Boolean? = null,
    val generationMatchesReady: Boolean? = null,
)

data class EmbeddingProvenanceContext(
    val embeddingGeneration: String?,
    val submitGeneration: String?,
    val sessionTokenPresent: Boolean,
    val hashMatchesReady: Boolean?,
    val generationMatchesReady: Boolean?,
)

object EmbeddingProvenanceLogger {
    fun record(
        repository: RecognitionLogRepository,
        event: EmbeddingProvenanceEvent,
        state: FaceDetectionState = FaceDetectionState(),
    ) {
        val persisted = runCatching {
            repository.record(
                RecognitionLogFactory.createProvenance(
                    event = event,
                    state = state,
                ),
            )
        }.getOrDefault(false)
        if (!persisted) {
            runCatching {
                Log.e(TAG, "ENROLLMENT_PROVENANCE persistence failed")
            }
        }
    }

    private const val TAG = "EmbeddingProvenanceLogger"
}

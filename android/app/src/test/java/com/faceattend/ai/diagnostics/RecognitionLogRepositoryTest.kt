package com.faceattend.ai.diagnostics

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RecognitionLogRepositoryTest {
    @Test
    fun recordsSuccessfulEnrollmentAndRoundTripsAllMetadata() {
        val storage = FakeStorage()
        val repository = RecognitionLogRepository(storage)
        val original = sample(
            operation = RecognitionOperation.ENROLLMENT,
            result = RecognitionLogResult.SUCCESS,
            selectedFace = SelectedFaceDiagnostic(7, 1, 2, 101, 102),
            candidateCount = 2,
            ambiguityMargin = 0.08,
        )

        assertTrue(repository.record(original))
        assertEquals(listOf(original), repository.all())
        assertEquals(original, RecognitionLogCodec.decode(repository.exportJson()).single())
    }

    @Test
    fun representsFailureAmbiguousUnknownCheckInAndCheckOut() {
        val repository = RecognitionLogRepository(FakeStorage())
        val cases = listOf(
            RecognitionOperation.FACE_RECOGNITION to RecognitionLogResult.FAILED,
            RecognitionOperation.FACE_RECOGNITION to RecognitionLogResult.AMBIGUOUS,
            RecognitionOperation.FACE_RECOGNITION to RecognitionLogResult.UNKNOWN,
            RecognitionOperation.CHECK_IN to RecognitionLogResult.SUCCESS,
            RecognitionOperation.CHECK_OUT to RecognitionLogResult.SUCCESS,
        )

        cases.forEachIndexed { index, (operation, result) ->
            assertTrue(
                repository.record(
                    sample(
                        id = "log-$index",
                        timestamp = index.toLong(),
                        operation = operation,
                        result = result,
                    ),
                ),
            )
        }

        assertEquals(cases.size, repository.all().size)
        assertEquals(
            cases.toSet(),
            repository.all().map { it.operation to it.result }.toSet(),
        )
    }

    @Test
    fun textExportContainsReadableSafeFieldsButNoBiometricPayload() {
        val log = sample(
            employeeName = "Zainab",
            topCandidate = "ZAINAB",
            topScore = 0.91,
            secondScore = 0.42,
            margin = 0.49,
        )
        val repository = RecognitionLogRepository(FakeStorage())
        repository.record(log)

        val json = repository.exportJson()
        val text = repository.exportText()
        assertTrue(json.startsWith("["))
        assertTrue(text.contains("Zainab"))
        assertTrue(text.contains("Top score: 0.91"))
        assertFalse(json.contains("faceImage"))
        assertFalse(json.contains("biometricVector"))
        assertFalse(json.contains("[0.1,0.2"))
    }

    @Test
    fun persistsAcrossRepositoryInstancesUsingSameStorage() {
        val storage = FakeStorage()
        val first = RecognitionLogRepository(storage)
        val second = RecognitionLogRepository(storage)
        first.record(sample())

        assertEquals(1, second.all().size)
        assertEquals(sample().id, second.all().single().id)
    }

    @Test
    fun retainsNewestFiveHundredEntries() {
        val repository = RecognitionLogRepository(FakeStorage())
        repeat(MAX_RECOGNITION_LOGS + 25) { index ->
            repository.record(sample(id = "log-$index", timestamp = index.toLong()))
        }

        val logs = repository.all()
        assertEquals(MAX_RECOGNITION_LOGS, logs.size)
        assertEquals("log-524", logs.first().id)
        assertEquals("log-25", logs.last().id)
    }

    @Test
    fun corruptedStorageRecoversAsEmptyAndCanAcceptNewLog() {
        val storage = FakeStorage("not-json")
        val repository = RecognitionLogRepository(storage)

        assertTrue(repository.all().isEmpty())
        assertTrue(repository.record(sample()))
        assertEquals(1, repository.all().size)
    }

    @Test
    fun storageFailureDoesNotEscapeIntoRecognitionCaller() {
        val repository = RecognitionLogRepository(FakeStorage(failWrites = true))

        assertFalse(runCatching { repository.record(sample()) }.isFailure)
        assertFalse(repository.record(sample()))
    }

    @Test
    fun provenanceMetadataRoundTripsWithoutEmbeddingValues() {
        val original = sample().copy(
            operation = RecognitionOperation.ENROLLMENT_PROVENANCE,
            provenanceStage = EmbeddingProvenanceStage.SUBMIT_PREPARED.name,
            provenanceEmbeddingSha256 = "a".repeat(64),
            provenanceEmbeddingGeneration = "generation-a",
            provenanceSubmitGeneration = "generation-b",
            provenanceSessionTokenPresent = true,
            provenanceHashMatchesReady = true,
            provenanceGenerationMatchesReady = false,
        )

        val encoded = RecognitionLogCodec.encode(listOf(original))
        val decoded = RecognitionLogCodec.decode(encoded).single()

        assertEquals(original, decoded)
        assertFalse(encoded.contains("0.1,0.2"))
    }

    private fun sample(
        id: String = "log-1",
        timestamp: Long = 1_000,
        operation: RecognitionOperation = RecognitionOperation.FACE_RECOGNITION,
        result: RecognitionLogResult = RecognitionLogResult.SUCCESS,
        employeeName: String? = null,
        topCandidate: String? = null,
        topScore: Double? = null,
        secondScore: Double? = null,
        margin: Double? = null,
        candidateCount: Int? = null,
        ambiguityMargin: Double? = null,
        selectedFace: SelectedFaceDiagnostic? = null,
    ) = RecognitionLog(
        id = id,
        timestampEpochMs = timestamp,
        operation = operation,
        result = result,
        employeeId = "employee-1",
        employeeCode = "E001",
        employeeName = employeeName,
        detectedFaceCount = 1,
        candidateCount = candidateCount,
        selectedFace = selectedFace,
        topCandidate = topCandidate,
        topSimilarityScore = topScore,
        secondSimilarityScore = secondScore,
        recognitionMargin = margin,
        threshold = 0.55,
        ambiguityMargin = ambiguityMargin,
        modelName = "glintr100.onnx",
        modelVersion = "test-version",
        modelSha256 = "test-sha",
        embeddingDimension = 512,
        embeddingGenerated = true,
        l2NormalizationSucceeded = true,
        cameraStatus = "AVAILABLE",
        faceDetectionStatus = "SINGLE_FACE",
        appVersion = "test",
        deviceManufacturer = "test",
        deviceModel = "test",
        androidVersion = "test",
        androidSdk = 35,
        processingDurationMs = 12,
    )

    private class FakeStorage(
        initial: String? = null,
        private val failWrites: Boolean = false,
    ) : RecognitionLogStorage {
        var value: String? = initial

        override fun read(): String? = value

        override fun write(value: String) {
            if (failWrites) error("simulated storage failure")
            this.value = value
        }

        override fun clear() {
            value = null
        }
    }
}

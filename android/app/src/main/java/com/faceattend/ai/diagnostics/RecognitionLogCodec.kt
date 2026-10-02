package com.faceattend.ai.diagnostics

import java.lang.StringBuilder

/** Small dependency-free JSON codec for the local diagnostic record format. */
object RecognitionLogCodec {
    fun encode(logs: List<RecognitionLog>): String = buildString {
        append("[\n")
        logs.forEachIndexed { index, log ->
            append("  ")
            appendLog(log)
            if (index != logs.lastIndex) append(',')
            append('\n')
        }
        append(']')
    }

    fun decode(value: String): List<RecognitionLog> {
        if (value.isBlank()) return emptyList()
        val root = JsonParser(value).parse()
        val records = root as? List<*> ?: throw IllegalArgumentException("logs must be an array")
        return records.map { item ->
            val map = item as? Map<*, *> ?: throw IllegalArgumentException("log must be an object")
            decodeLog(map)
        }
    }

    private fun StringBuilder.appendLog(log: RecognitionLog) {
        append('{')
        field("id", log.id)
        field("timestampEpochMs", log.timestampEpochMs)
        field("operation", log.operation.name)
        field("result", log.result.name)
        field("employeeId", log.employeeId)
        field("employeeCode", log.employeeCode)
        field("employeeName", log.employeeName)
        field("detectedFaceCount", log.detectedFaceCount)
        field("candidateCount", log.candidateCount)
        field("selectedFace", log.selectedFace?.let { face ->
            RawJson(
                "{" +
                    jsonField("trackingId", face.trackingId) +
                    jsonField("left", face.left) +
                    jsonField("top", face.top) +
                    jsonField("right", face.right) +
                    jsonField("bottom", face.bottom, last = true) +
                    "}",
            )
        })
        field("topCandidate", log.topCandidate)
        field("topSimilarityScore", log.topSimilarityScore)
        field("secondSimilarityScore", log.secondSimilarityScore)
        field("recognitionMargin", log.recognitionMargin)
        field("threshold", log.threshold)
        field("ambiguityMargin", log.ambiguityMargin)
        field("modelName", log.modelName)
        field("modelVersion", log.modelVersion)
        field("modelSha256", log.modelSha256)
        field("embeddingDimension", log.embeddingDimension)
        field("embeddingGenerated", log.embeddingGenerated)
        field("l2NormalizationSucceeded", log.l2NormalizationSucceeded)
        field("cameraStatus", log.cameraStatus)
        field("faceDetectionStatus", log.faceDetectionStatus)
        field("errorCode", log.errorCode)
        field("errorMessage", log.errorMessage)
        field("appVersion", log.appVersion)
        field("deviceManufacturer", log.deviceManufacturer)
        field("deviceModel", log.deviceModel)
        field("androidVersion", log.androidVersion)
        field("androidSdk", log.androidSdk)
        field("processingDurationMs", log.processingDurationMs)
        field("diagnosticInfo", log.diagnosticInfo)
        field("provenanceStage", log.provenanceStage)
        field("provenanceEmbeddingSha256", log.provenanceEmbeddingSha256)
        field("provenanceEmbeddingGeneration", log.provenanceEmbeddingGeneration)
        field("provenanceSubmitGeneration", log.provenanceSubmitGeneration)
        field("provenanceSessionTokenPresent", log.provenanceSessionTokenPresent)
        field("provenanceHashMatchesReady", log.provenanceHashMatchesReady)
        field("provenanceGenerationMatchesReady", log.provenanceGenerationMatchesReady)
        field("enrollmentDiagnosticId", log.enrollmentDiagnosticId)
        field("enrollmentDiagnosticImageSha256", log.enrollmentDiagnosticImageSha256)
        field("enrollmentDiagnosticTensorSha256", log.enrollmentDiagnosticTensorSha256, last = true)
        append('}')
    }

    private fun StringBuilder.field(name: String, value: Any?, last: Boolean = false) {
        append(jsonField(name, value, last))
    }

    private fun jsonField(name: String, value: Any?, last: Boolean = false): String =
        buildString {
            append(jsonString(name))
            append(':')
            append(jsonValue(value))
            if (!last) append(',')
        }

    private fun jsonValue(value: Any?): String = when (value) {
        null -> "null"
        is String -> jsonString(value)
        is RawJson -> value.value
        is Boolean -> value.toString()
        is Number -> value.toString()
        else -> throw IllegalArgumentException("unsupported JSON value")
    }

    private fun jsonString(value: String): String = buildString {
        append('"')
        value.forEach { character ->
            when (character) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                else -> if (character.code < 0x20) {
                    append("\\u%04x".format(character.code))
                } else {
                    append(character)
                }
            }
        }
        append('"')
    }

    private data class RawJson(val value: String)

    private fun decodeLog(map: Map<*, *>): RecognitionLog = RecognitionLog(
        id = map.requiredString("id"),
        timestampEpochMs = map.requiredLong("timestampEpochMs"),
        operation = RecognitionOperation.valueOf(map.requiredString("operation")),
        result = RecognitionLogResult.valueOf(map.requiredString("result")),
        employeeId = map.optionalString("employeeId"),
        employeeCode = map.optionalString("employeeCode"),
        employeeName = map.optionalString("employeeName"),
        detectedFaceCount = map.optionalInt("detectedFaceCount"),
        candidateCount = map.optionalInt("candidateCount"),
        selectedFace = (map["selectedFace"] as? Map<*, *>)?.let { face ->
            SelectedFaceDiagnostic(
                trackingId = face.optionalInt("trackingId"),
                left = face.requiredInt("left"),
                top = face.requiredInt("top"),
                right = face.requiredInt("right"),
                bottom = face.requiredInt("bottom"),
            )
        },
        topCandidate = map.optionalString("topCandidate"),
        topSimilarityScore = map.optionalDouble("topSimilarityScore"),
        secondSimilarityScore = map.optionalDouble("secondSimilarityScore"),
        recognitionMargin = map.optionalDouble("recognitionMargin"),
        threshold = map.optionalDouble("threshold"),
        ambiguityMargin = map.optionalDouble("ambiguityMargin"),
        modelName = map.optionalString("modelName"),
        modelVersion = map.optionalString("modelVersion"),
        modelSha256 = map.optionalString("modelSha256"),
        embeddingDimension = map.optionalInt("embeddingDimension"),
        embeddingGenerated = map.optionalBoolean("embeddingGenerated") ?: false,
        l2NormalizationSucceeded = map.optionalBoolean("l2NormalizationSucceeded"),
        cameraStatus = map.optionalString("cameraStatus"),
        faceDetectionStatus = map.optionalString("faceDetectionStatus"),
        errorCode = map.optionalString("errorCode"),
        errorMessage = map.optionalString("errorMessage"),
        appVersion = map.optionalString("appVersion"),
        deviceManufacturer = map.optionalString("deviceManufacturer"),
        deviceModel = map.optionalString("deviceModel"),
        androidVersion = map.optionalString("androidVersion"),
        androidSdk = map.optionalInt("androidSdk"),
        processingDurationMs = map.optionalLong("processingDurationMs"),
        diagnosticInfo = map.optionalString("diagnosticInfo"),
        provenanceStage = map.optionalString("provenanceStage"),
        provenanceEmbeddingSha256 = map.optionalString("provenanceEmbeddingSha256"),
        provenanceEmbeddingGeneration = map.optionalString("provenanceEmbeddingGeneration"),
        provenanceSubmitGeneration = map.optionalString("provenanceSubmitGeneration"),
        provenanceSessionTokenPresent = map.optionalBoolean("provenanceSessionTokenPresent"),
        provenanceHashMatchesReady = map.optionalBoolean("provenanceHashMatchesReady"),
        provenanceGenerationMatchesReady = map.optionalBoolean("provenanceGenerationMatchesReady"),
        enrollmentDiagnosticId = map.optionalString("enrollmentDiagnosticId"),
        enrollmentDiagnosticImageSha256 = map.optionalString("enrollmentDiagnosticImageSha256"),
        enrollmentDiagnosticTensorSha256 = map.optionalString("enrollmentDiagnosticTensorSha256"),
    )

    private fun Map<*, *>.requiredString(key: String): String =
        optionalString(key) ?: throw IllegalArgumentException("missing $key")

    private fun Map<*, *>.requiredLong(key: String): Long =
        optionalLong(key) ?: throw IllegalArgumentException("missing $key")

    private fun Map<*, *>.requiredInt(key: String): Int =
        optionalInt(key) ?: throw IllegalArgumentException("missing $key")

    private fun Map<*, *>.optionalString(key: String): String? = this[key] as? String

    private fun Map<*, *>.optionalLong(key: String): Long? = when (val value = this[key]) {
        is Long -> value
        is Double -> value.toLong()
        is Int -> value.toLong()
        else -> null
    }

    private fun Map<*, *>.optionalInt(key: String): Int? = optionalLong(key)?.toInt()

    private fun Map<*, *>.optionalDouble(key: String): Double? = when (val value = this[key]) {
        is Number -> value.toDouble().takeIf(Double::isFinite)
        else -> null
    }

    private fun Map<*, *>.optionalBoolean(key: String): Boolean? = this[key] as? Boolean

    private class JsonParser(private val input: String) {
        private var index = 0

        fun parse(): Any? {
            skipWhitespace()
            val value = parseValue()
            skipWhitespace()
            require(index == input.length) { "trailing JSON data" }
            return value
        }

        private fun parseValue(): Any? {
            skipWhitespace()
            require(index < input.length) { "unexpected end of JSON" }
            return when (input[index]) {
                '{' -> parseObject()
                '[' -> parseArray()
                '"' -> parseString()
                't' -> parseLiteral("true", true)
                'f' -> parseLiteral("false", false)
                'n' -> parseLiteral("null", null)
                '-', in '0'..'9' -> parseNumber()
                else -> throw IllegalArgumentException("invalid JSON value")
            }
        }

        private fun parseObject(): Map<String, Any?> {
            expect('{')
            val result = linkedMapOf<String, Any?>()
            skipWhitespace()
            if (consume('}')) return result
            while (true) {
                val key = parseString()
                skipWhitespace()
                expect(':')
                result[key] = parseValue()
                skipWhitespace()
                if (consume('}')) return result
                expect(',')
            }
        }

        private fun parseArray(): List<Any?> {
            expect('[')
            val result = mutableListOf<Any?>()
            skipWhitespace()
            if (consume(']')) return result
            while (true) {
                result += parseValue()
                skipWhitespace()
                if (consume(']')) return result
                expect(',')
            }
        }

        private fun parseString(): String {
            expect('"')
            val result = StringBuilder()
            while (index < input.length) {
                when (val character = input[index++]) {
                    '"' -> return result.toString()
                    '\\' -> {
                        require(index < input.length) { "invalid string escape" }
                        when (val escaped = input[index++]) {
                            '"', '\\', '/' -> result.append(escaped)
                            'b' -> result.append('\b')
                            'f' -> result.append('\u000C')
                            'n' -> result.append('\n')
                            'r' -> result.append('\r')
                            't' -> result.append('\t')
                            'u' -> {
                                require(index + 4 <= input.length) { "invalid unicode escape" }
                                result.append(input.substring(index, index + 4).toInt(16).toChar())
                                index += 4
                            }
                            else -> throw IllegalArgumentException("invalid string escape")
                        }
                    }
                    else -> {
                        require(character.code >= 0x20) { "invalid control character" }
                        result.append(character)
                    }
                }
            }
            throw IllegalArgumentException("unterminated string")
        }

        private fun parseNumber(): Number {
            val start = index
            if (consume('-')) Unit
            while (index < input.length && input[index].isDigit()) index++
            var decimal = false
            if (consume('.')) {
                decimal = true
                while (index < input.length && input[index].isDigit()) index++
            }
            if (index < input.length && (input[index] == 'e' || input[index] == 'E')) {
                decimal = true
                index++
                if (index < input.length && (input[index] == '+' || input[index] == '-')) index++
                while (index < input.length && input[index].isDigit()) index++
            }
            val token = input.substring(start, index)
            return if (decimal) token.toDouble() else token.toLong()
        }

        private fun parseLiteral(literal: String, value: Any?): Any? {
            require(input.startsWith(literal, index)) { "invalid JSON literal" }
            index += literal.length
            return value
        }

        private fun skipWhitespace() {
            while (index < input.length && input[index].isWhitespace()) index++
        }

        private fun expect(character: Char) {
            require(index < input.length && input[index] == character) { "expected $character" }
            index++
        }

        private fun consume(character: Char): Boolean = if (index < input.length && input[index] == character) {
            index++
            true
        } else {
            false
        }
    }
}

package com.faceattend.ai.enrollment

import com.faceattend.ai.BuildConfig
import com.faceattend.ai.diagnostics.EmbeddingProvenanceContext
import com.faceattend.ai.diagnostics.EmbeddingProvenanceEvent
import com.faceattend.ai.diagnostics.EmbeddingProvenanceStage
import com.faceattend.ai.face.embedding.EMBEDDING_DIMENSION
import com.faceattend.ai.face.embedding.EmbeddingProvenanceHasher
import com.faceattend.ai.face.embedding.MODEL_ASSET_NAME
import com.faceattend.ai.face.embedding.MODEL_VERSION
import com.faceattend.ai.face.embedding.EmbeddingValidator
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

sealed interface EnrollmentSubmitResult {
    data class Success(val completedAt: String?) : EnrollmentSubmitResult
    data class Failure(
        val message: String,
        val authenticationFailure: Boolean = false,
    ) : EnrollmentSubmitResult
}

/** HTTPS-only client for the two authenticated enrollment Edge Functions. */
class EnrollmentApiClient(
    private val supabaseUrl: String = BuildConfig.SUPABASE_URL,
    private val anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
) {
    fun submitEnrollment(
        accessToken: String,
        sessionToken: String,
        embedding: FloatArray,
        provenanceContext: EmbeddingProvenanceContext? = null,
        onProvenanceEvent: (EmbeddingProvenanceEvent) -> Unit = {},
    ): EnrollmentSubmitResult {
        require(accessToken.isNotBlank()) { "Device session is required" }
        require(sessionToken.isNotBlank()) { "Enrollment session token is required" }
        require(embedding.size == EMBEDDING_DIMENSION) { "Embedding must contain 512 values" }
        EmbeddingValidator.validateNormalized(embedding)

        runCatching {
            onProvenanceEvent(
                EmbeddingProvenanceEvent(
                    stage = EmbeddingProvenanceStage.API_PAYLOAD,
                    embeddingSha256 = EmbeddingProvenanceHasher.sha256(embedding),
                    embeddingGeneration = provenanceContext?.embeddingGeneration,
                    submitGeneration = provenanceContext?.submitGeneration,
                    sessionTokenPresent = provenanceContext?.sessionTokenPresent ?: sessionToken.isNotBlank(),
                    hashMatchesReady = provenanceContext?.hashMatchesReady,
                    generationMatchesReady = provenanceContext?.generationMatchesReady,
                ),
            )
        }

        val values = JSONArray()
        embedding.forEach(values::put)
        val response = request(
            method = "POST",
            path = "/functions/v1/enrollment-submit",
            bearerToken = accessToken,
            body = JSONObject()
                .put("session_token", sessionToken.trim())
                .put("embedding", values)
                .put("model_name", MODEL_ASSET_NAME)
                .put("model_version", MODEL_VERSION)
                .put("app_version", BuildConfig.VERSION_NAME)
                .toString(),
        )
        if (response.status in 200..299) {
            return EnrollmentSubmitResult.Success(JSONObject(response.body).optString("completed_at").ifBlank { null })
        }
        return EnrollmentSubmitResult.Failure(
            message = when (response.status) {
                401 -> "Device authentication failed. Sign in again."
                403 -> "This enrollment device is inactive."
                409 -> "This employee is already enrolled or the session was used."
                410 -> "The enrollment session expired. Ask the administrator for a new one."
                422 -> "The enrollment session or model is invalid."
                else -> "Enrollment could not be completed. Please try again."
            },
            authenticationFailure = response.status == 401,
        )
    }

    private fun request(
        method: String,
        path: String,
        bearerToken: String?,
        body: String,
    ): HttpResponse {
        require(supabaseUrl.startsWith("https://")) { "Supabase URL must use HTTPS" }
        require(anonKey.isNotBlank()) { "Supabase public configuration is missing" }
        val connection = (URL(supabaseUrl.trimEnd('/') + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 10_000
            readTimeout = 15_000
            doInput = true
            doOutput = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("apikey", anonKey)
            bearerToken?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        return try {
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            HttpResponse(status, responseBody)
        } finally {
            connection.disconnect()
        }
    }

    private data class HttpResponse(val status: Int, val body: String)
}

class EnrollmentApiException(message: String) : IllegalStateException(message)

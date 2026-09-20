package com.faceattend.ai.attendance

import android.util.Log
import com.faceattend.ai.BuildConfig
import com.faceattend.ai.face.embedding.EMBEDDING_DIMENSION
import com.faceattend.ai.face.embedding.EmbeddingValidator
import com.faceattend.ai.face.embedding.MODEL_ASSET_NAME
import com.faceattend.ai.face.embedding.MODEL_VERSION
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

enum class AttendanceOutcome {
    CHECK_IN_RECORDED,
    CHECK_OUT_RECORDED,
    NOT_RECORDED,
}

sealed interface AttendanceSubmitResult {
    data class Success(
        val outcome: AttendanceOutcome,
        val serverTime: String?,
        val employeeName: String?,
        val employeeCode: String?,
    ) : AttendanceSubmitResult

    data class Failure(
        val message: String,
        val authenticationFailure: Boolean = false,
        val diagnosticSummary: String? = null,
    ) : AttendanceSubmitResult
}

/** HTTPS-only client for the existing attendance-submit Edge Function. */
class AttendanceApiClient(
    private val supabaseUrl: String = BuildConfig.SUPABASE_URL,
    private val anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
) {
    fun submitCheckIn(
        accessToken: String,
        requestId: String,
        embedding: FloatArray,
    ): AttendanceSubmitResult {
        Log.d(
            ATTENDANCE_DEBUG_TAG,
            "SUBMIT_ENTERED request_id=$requestId accessTokenPresent=${accessToken.isNotBlank()} " +
                "embeddingPresent=${embedding.isNotEmpty()} embeddingDimension=${embedding.size} " +
                "action=CHECK_IN modelName=$MODEL_ASSET_NAME modelVersion=$MODEL_VERSION " +
                "appVersion=${BuildConfig.VERSION_NAME}",
        )
        try {
            require(accessToken.isNotBlank()) { "Device session is required" }
            require(requestId.isNotBlank()) { "Attendance request ID is required" }
            require(embedding.size == EMBEDDING_DIMENSION) { "Embedding must contain 512 values" }
            EmbeddingValidator.validateNormalized(embedding)

            val values = JSONArray()
            embedding.forEach(values::put)
            val response = request(
                method = "POST",
                path = ATTENDANCE_PATH,
                bearerToken = accessToken,
                body = JSONObject()
                    .put("request_id", requestId)
                    .put("action", "CHECK_IN")
                    .put("embedding", values)
                    .put("model_name", MODEL_ASSET_NAME)
                    .put("model_version", MODEL_VERSION)
                    .put("app_version", BuildConfig.VERSION_NAME)
                    .toString(),
            )
            logSafeResponseFields(response.status, response.body)
            if (response.status in 200..299) {
                val payload = try {
                    JSONObject(response.body).also {
                        Log.d(ATTENDANCE_DEBUG_TAG, "RESPONSE_JSON_PARSED=true")
                    }
                } catch (error: Throwable) {
                    Log.e(
                        ATTENDANCE_DEBUG_TAG,
                        "RESPONSE_JSON_PARSED=false exception=${safeExceptionSummary(error)}",
                    )
                    throw error
                }
                val outcome = runCatching {
                    AttendanceOutcome.valueOf(payload.getString("outcome"))
                }.getOrElse { throw AttendanceApiException("Attendance response was invalid") }
                return AttendanceSubmitResult.Success(
                    outcome = outcome,
                    serverTime = payload.optString("server_time").ifBlank { null },
                    employeeName = payload.optString("employee_name").ifBlank { null },
                    employeeCode = payload.optString("employee_code").ifBlank { null },
                ).also {
                    Log.d(
                        ATTENDANCE_DEBUG_TAG,
                        "RESULT_RETURNED=SUCCESS outcome=${it.outcome} " +
                            "employeeIdentified=${it.employeeCode != null || it.employeeName != null}",
                    )
                }
            }

            return AttendanceSubmitResult.Failure(
                message = when (response.status) {
                    401 -> "Device authentication expired. Sign in again."
                    403 -> "This attendance device is inactive."
                    422 -> "Attendance request was rejected. Please try again."
                    429 -> "Too many attendance attempts. Please wait and try again."
                    else -> "Attendance could not be recorded. Please try again."
                },
                authenticationFailure = response.status == 401,
                diagnosticSummary = safeHttpSummary(response.status, response.body),
            ).also {
                Log.d(
                    ATTENDANCE_DEBUG_TAG,
                    "RESULT_RETURNED=FAILURE httpStatus=${response.status} " +
                        "authenticationFailure=${it.authenticationFailure}",
                )
            }
        } catch (error: Throwable) {
            Log.e(
                ATTENDANCE_DEBUG_TAG,
                "SUBMIT_EXCEPTION class=${error.javaClass.name} message=${safeExceptionSummary(error)}",
            )
            throw error
        }
    }

    private fun request(
        method: String,
        path: String,
        bearerToken: String?,
        body: String,
    ): HttpResponse {
        require(supabaseUrl.startsWith("https://")) { "Supabase URL must use HTTPS" }
        require(anonKey.isNotBlank()) { "Supabase public configuration is missing" }
        Log.d(ATTENDANCE_DEBUG_TAG, "HTTP_REQUEST_STARTED method=$method path=$path")
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
            Log.d(
                ATTENDANCE_DEBUG_TAG,
                "HTTP_RESPONSE_RECEIVED status=$status responseBodyLength=${responseBody.length}",
            )
            HttpResponse(status, responseBody)
        } catch (error: Throwable) {
            Log.e(
                ATTENDANCE_DEBUG_TAG,
                "HTTP_REQUEST_EXCEPTION class=${error.javaClass.name} message=${safeExceptionSummary(error)}",
            )
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun logSafeResponseFields(status: Int, body: String) {
        val payload = runCatching { JSONObject(body) }.getOrNull()
        if (payload == null) {
            Log.d(ATTENDANCE_DEBUG_TAG, "RESPONSE_JSON_SAFE_PARSE=false httpStatus=$status")
            return
        }
        Log.d(ATTENDANCE_DEBUG_TAG, "RESPONSE_JSON_SAFE_PARSE=true httpStatus=$status")
        listOf("outcome", "error", "error_code", "code", "message", "error_description")
            .forEach { key ->
                payload.optString(key).takeIf { it.isNotBlank() }?.let { value ->
                    Log.d(ATTENDANCE_DEBUG_TAG, "RESPONSE_$key=${safeText(value)}")
                }
            }
    }

    private fun safeHttpSummary(status: Int, body: String): String {
        val payload = runCatching { JSONObject(body) }.getOrNull()
        val detail = payload?.let {
            listOf("error_code", "error", "code", "message", "error_description")
                .firstNotNullOfOrNull { key -> it.optString(key).takeIf(String::isNotBlank) }
        }
        return "HTTP $status" + (detail?.let { " - ${safeText(it)}" } ?: "")
    }

    private fun safeExceptionSummary(error: Throwable): String {
        val message = error.message?.let(::safeText).orEmpty().ifBlank { "no message" }
        return "${error.javaClass.simpleName} - $message"
    }

    private fun safeText(value: String): String = value
        .replace(Regex("(?i)(access_token|refresh_token|authorization|apikey|service[-_ ]role|password|embedding)\\s*[:=]\\s*[^,;\\s]+"), "$1=<redacted>")
        .replace(Regex("[\\r\\n]+"), " ")
        .take(160)

    private data class HttpResponse(val status: Int, val body: String)

    private companion object {
        const val ATTENDANCE_PATH = "/functions/v1/attendance-submit"
        const val ATTENDANCE_DEBUG_TAG = "FACEATTEND_ATTENDANCE_DEBUG"
    }
}

class AttendanceApiException(message: String) : IllegalStateException(message)

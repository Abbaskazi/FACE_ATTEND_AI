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
import java.util.concurrent.atomic.AtomicBoolean

enum class AttendanceAction {
    CHECK_IN,
    CHECK_OUT,
}

enum class AttendanceOutcome {
    CHECK_IN_RECORDED,
    ALREADY_CHECKED_IN,
    CHECK_OUT_RECORDED,
    NOT_CHECKED_IN,
    RECOGNITION_FAILED,
    AMBIGUOUS_MATCH,
    NOT_RECORDED,
    UNAUTHORIZED_DEVICE,
    RATE_LIMITED,
    VALIDATION_ERROR,
    SERVER_ERROR,
}

sealed interface AttendanceSubmitResult {
    data class Success(
        val outcome: AttendanceOutcome,
        val serverTime: String?,
        val employeeName: String?,
        val employeeCode: String?,
        val checkInTime: String?,
        val checkOutTime: String?,
        val sessionWorkingMinutes: Int?,
        val todayTotalWorkingMinutes: Int?,
        val diagnostic: AttendanceDiagnosticSummary? = null,
    ) : AttendanceSubmitResult

    data class Failure(
        val message: String,
        val authenticationFailure: Boolean = false,
        val diagnosticSummary: String? = null,
        val diagnostic: AttendanceDiagnosticSummary? = null,
    ) : AttendanceSubmitResult
}

data class AttendanceDiagnosticSummary(
    val candidateCount: Int?,
    val topEmployeeCode: String?,
    val topScore: Double?,
    val secondEmployeeCode: String?,
    val secondScore: Double?,
    val scoreMargin: Double?,
    val threshold: Double?,
    val ambiguityMargin: Double?,
    val decision: String?,
    val modelName: String?,
    val modelVersion: String?,
    val embeddingDimension: Int?,
    val normalizationStatus: String?,
)

/** HTTPS-only client for the existing attendance-submit Edge Function. */
class AttendanceApiClient(
    private val supabaseUrl: String = BuildConfig.SUPABASE_URL,
    private val anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
) {
    private val diagnosticAttemptCaptured = AtomicBoolean(false)

    fun submit(
        accessToken: String,
        requestId: String,
        embedding: FloatArray,
        action: AttendanceAction,
    ): AttendanceSubmitResult {
        var diagnosticContext: AttendanceDiagnosticContext? = null
        Log.d(
            ATTENDANCE_DEBUG_TAG,
            "SUBMIT_ENTERED request_id=$requestId accessTokenPresent=${accessToken.isNotBlank()} " +
                "embeddingPresent=${embedding.isNotEmpty()} embeddingDimension=${embedding.size} " +
                "action=$action modelName=$MODEL_ASSET_NAME modelVersion=$MODEL_VERSION " +
                "appVersion=${BuildConfig.VERSION_NAME}",
        )
        try {
            require(accessToken.isNotBlank()) { "Device session is required" }
            require(requestId.isNotBlank()) { "Attendance request ID is required" }
            require(embedding.size == EMBEDDING_DIMENSION) { "Embedding must contain 512 values" }
            EmbeddingValidator.validateNormalized(embedding)

            diagnosticContext = if (diagnosticAttemptCaptured.compareAndSet(false, true)) {
                AttendanceDiagnosticContext(
                    requestId = requestId,
                    method = "POST",
                    endpointPath = ATTENDANCE_PATH,
                    action = action,
                    embeddingDimension = embedding.size,
                    modelName = MODEL_ASSET_NAME,
                    modelVersion = MODEL_VERSION,
                    authorizationHeaderPresent = accessToken.isNotBlank(),
                )
            } else {
                null
            }
            diagnosticContext?.let {
                Log.i(
                    ATTENDANCE_DEBUG_TAG,
                    "ATTENDANCE_DIAGNOSTIC_REQUEST requestId=${it.requestId} " +
                        "method=${it.method} endpointPath=${it.endpointPath} action=${it.action} " +
                        "embeddingDimension=${it.embeddingDimension} modelName=${it.modelName} " +
                        "modelVersion=${it.modelVersion} " +
                        "authorizationHeaderPresent=${it.authorizationHeaderPresent}",
                )
            }

            val values = JSONArray()
            embedding.forEach(values::put)
            val response = request(
                method = "POST",
                path = ATTENDANCE_PATH,
                bearerToken = accessToken,
                diagnosticContext = diagnosticContext,
                body = JSONObject()
                    .put("request_id", requestId)
                    .put("action", action.name)
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
                }.onSuccess { parsedOutcome ->
                    diagnosticContext?.let { diagnostic ->
                        Log.i(
                            ATTENDANCE_DEBUG_TAG,
                            "ATTENDANCE_DIAGNOSTIC_OUTCOME_PARSE requestId=${diagnostic.requestId} " +
                                "success=true outcome=$parsedOutcome",
                        )
                    }
                }.onFailure { error ->
                    diagnosticContext?.let { diagnostic ->
                        Log.i(
                            ATTENDANCE_DEBUG_TAG,
                            "ATTENDANCE_DIAGNOSTIC_OUTCOME_PARSE requestId=${diagnostic.requestId} " +
                                "success=false exceptionClass=${error.javaClass.simpleName} " +
                                "exceptionMessage=${safeText(error.message ?: "no message")}",
                        )
                    }
                }.getOrElse { throw AttendanceApiException("Attendance response was invalid") }
                val serverTime = payload.optionalNonBlankString("server_time")
                val employeeName = payload.optionalNonBlankString("employee_name")
                val employeeCode = payload.optionalNonBlankString("employee_code")
                if (outcome !in setOf(
                        AttendanceOutcome.RECOGNITION_FAILED,
                        AttendanceOutcome.AMBIGUOUS_MATCH,
                        AttendanceOutcome.NOT_RECORDED,
                    ) &&
                    (serverTime == null || employeeName == null || employeeCode == null)
                ) {
                    throw AttendanceApiException("Attendance response omitted employee details")
                }
                return AttendanceSubmitResult.Success(
                    outcome = outcome,
                    serverTime = serverTime,
                    employeeName = employeeName,
                    employeeCode = employeeCode,
                    checkInTime = payload.optionalNonBlankString("check_in_time"),
                    checkOutTime = payload.optionalNonBlankString("check_out_time"),
                    sessionWorkingMinutes = payload.optionalInt("session_working_minutes"),
                    todayTotalWorkingMinutes = payload.optionalInt("today_total_working_minutes"),
                    diagnostic = parseDiagnostic(payload),
                ).also {
                    Log.d(
                        ATTENDANCE_DEBUG_TAG,
                        "RESULT_RETURNED=SUCCESS outcome=${it.outcome} " +
                            "employeeIdentified=${it.employeeCode != null || it.employeeName != null}",
                    )
                }
            }

            return AttendanceSubmitResult.Failure(
                message = when (payloadOutcome(response.body)) {
                    AttendanceOutcome.UNAUTHORIZED_DEVICE -> "This device is not authorized."
                    AttendanceOutcome.RATE_LIMITED -> "Too many attendance attempts. Please wait and try again."
                    AttendanceOutcome.VALIDATION_ERROR -> "Attendance request was rejected. Please try again."
                    else -> when (response.status) {
                    401 -> "Device authentication expired. Sign in again."
                    403 -> "This device is not authorized."
                    422 -> "Attendance request was rejected. Please try again."
                    429 -> "Too many attendance attempts. Please wait and try again."
                    else -> "Unable to process attendance. Please try again."
                    }
                },
                authenticationFailure = response.status == 401,
                diagnosticSummary = safeHttpSummary(response.status, response.body),
                diagnostic = parseDiagnostic(response.body),
            ).also {
                Log.d(
                    ATTENDANCE_DEBUG_TAG,
                    "RESULT_RETURNED=FAILURE httpStatus=${response.status} " +
                        "authenticationFailure=${it.authenticationFailure}",
                )
            }
        } catch (error: Throwable) {
            diagnosticContext?.let {
                Log.i(
                    ATTENDANCE_DEBUG_TAG,
                    "ATTENDANCE_DIAGNOSTIC_EXCEPTION requestId=${it.requestId} " +
                        "exceptionClass=${error.javaClass.simpleName} " +
                        "exceptionMessage=${safeText(error.message ?: "no message")}",
                )
            }
            Log.e(
                ATTENDANCE_DEBUG_TAG,
                "SUBMIT_EXCEPTION class=${error.javaClass.name} message=${safeExceptionSummary(error)}",
            )
            throw error
        }
    }

    fun submitCheckIn(
        accessToken: String,
        requestId: String,
        embedding: FloatArray,
    ): AttendanceSubmitResult = submit(accessToken, requestId, embedding, AttendanceAction.CHECK_IN)

    fun submitCheckOut(
        accessToken: String,
        requestId: String,
        embedding: FloatArray,
    ): AttendanceSubmitResult = submit(accessToken, requestId, embedding, AttendanceAction.CHECK_OUT)

    private fun request(
        method: String,
        path: String,
        bearerToken: String?,
        diagnosticContext: AttendanceDiagnosticContext?,
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
            val contentType = connection.contentType?.let(::safeText).orEmpty().ifBlank { "none" }
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            Log.d(
                ATTENDANCE_DEBUG_TAG,
                "HTTP_RESPONSE_RECEIVED status=$status responseBodyLength=${responseBody.length}",
            )
            val response = HttpResponse(status, contentType, responseBody)
            diagnosticContext?.let { logDiagnosticResponse(it, response) }
            response
        } catch (error: Throwable) {
            diagnosticContext?.let {
                Log.i(
                    ATTENDANCE_DEBUG_TAG,
                    "ATTENDANCE_DIAGNOSTIC_HTTP_EXCEPTION requestId=${it.requestId} " +
                        "responseContentType=unavailable responseLength=0 " +
                        "exceptionClass=${error.javaClass.simpleName} " +
                        "exceptionMessage=${safeText(error.message ?: "no message")}",
                )
            }
            Log.e(
                ATTENDANCE_DEBUG_TAG,
                "HTTP_REQUEST_EXCEPTION class=${error.javaClass.name} message=${safeExceptionSummary(error)}",
            )
            throw error
        } finally {
            connection.disconnect()
        }
    }

    private fun logDiagnosticResponse(
        context: AttendanceDiagnosticContext,
        response: HttpResponse,
    ) {
        val payload = runCatching { JSONObject(response.body) }.getOrNull()
        val jsonParsed = payload != null
        val outcome = payload?.optString("outcome")?.takeIf { it.isNotBlank() }
        val errorCode = payload?.let {
            listOf("error_code", "code").firstNotNullOfOrNull { key ->
                it.optString(key).takeIf(String::isNotBlank)
            }
        }
        val errorMessage = payload?.let {
            listOf("error", "message", "error_description").firstNotNullOfOrNull { key ->
                it.optString(key).takeIf(String::isNotBlank)
            }
        }
        Log.i(
            ATTENDANCE_DEBUG_TAG,
            "ATTENDANCE_DIAGNOSTIC_RESPONSE requestId=${context.requestId} " +
                "method=${context.method} endpointPath=${context.endpointPath} " +
                "action=${context.action} embeddingDimension=${context.embeddingDimension} " +
                "modelName=${context.modelName} modelVersion=${context.modelVersion} " +
                "authorizationHeaderPresent=${context.authorizationHeaderPresent} " +
                "httpStatus=${response.status} responseContentType=${response.contentType} " +
                "responseLength=${response.body.toByteArray(Charsets.UTF_8).size} " +
                "responseJsonParseSuccess=$jsonParsed " +
                "backendOutcome=${outcome?.let(::safeText) ?: "none"} " +
                "backendErrorCode=${errorCode?.let(::safeText) ?: "none"} " +
                "backendErrorMessage=${errorMessage?.let(::safeText) ?: "none"}",
        )
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

    private fun JSONObject.optionalNonBlankString(key: String): String? {
        if (!has(key) || isNull(key)) return null
        return optString(key).trim().takeIf { it.isNotEmpty() }
    }

    private fun JSONObject.optionalInt(key: String): Int? {
        if (!has(key) || isNull(key)) return null
        return optInt(key).takeIf { it >= 0 }
    }

    private fun payloadOutcome(body: String): AttendanceOutcome? = runCatching {
        AttendanceOutcome.valueOf(JSONObject(body).optString("outcome"))
    }.getOrNull()

    private fun parseDiagnostic(body: String): AttendanceDiagnosticSummary? = runCatching {
        parseDiagnostic(JSONObject(body))
    }.getOrNull()

    private fun parseDiagnostic(payload: JSONObject): AttendanceDiagnosticSummary? {
        val diagnostic = payload.optJSONObject("diagnostic") ?: return null
        return runCatching {
        AttendanceDiagnosticSummary(
            candidateCount = diagnostic.optionalInt("candidate_count"),
            topEmployeeCode = diagnostic.optionalNonBlankString("top_employee_code"),
            topScore = diagnostic.optionalDouble("top_score"),
            secondEmployeeCode = diagnostic.optionalNonBlankString("second_employee_code"),
            secondScore = diagnostic.optionalDouble("second_score"),
            scoreMargin = diagnostic.optionalDouble("score_margin"),
            threshold = diagnostic.optionalDouble("threshold"),
            ambiguityMargin = diagnostic.optionalDouble("ambiguity_margin"),
            decision = diagnostic.optionalNonBlankString("decision"),
            modelName = diagnostic.optionalNonBlankString("model_name"),
            modelVersion = diagnostic.optionalNonBlankString("model_version"),
            embeddingDimension = diagnostic.optionalInt("embedding_dimension"),
            normalizationStatus = diagnostic.optionalNonBlankString("normalization_status"),
        )
        }.getOrNull()
    }

    private fun JSONObject.optionalDouble(key: String): Double? = if (!has(key) || isNull(key)) {
        null
    } else {
        optDouble(key).takeIf(Double::isFinite)
    }

    private data class AttendanceDiagnosticContext(
        val requestId: String,
        val method: String,
        val endpointPath: String,
        val action: AttendanceAction,
        val embeddingDimension: Int,
        val modelName: String,
        val modelVersion: String,
        val authorizationHeaderPresent: Boolean,
    )

    private data class HttpResponse(
        val status: Int,
        val contentType: String,
        val body: String,
    )

    private companion object {
        const val ATTENDANCE_PATH = "/functions/v1/attendance-submit"
        const val ATTENDANCE_DEBUG_TAG = "FACEATTEND_ATTENDANCE_DEBUG"
    }
}

class AttendanceApiException(message: String) : IllegalStateException(message)

package com.faceattend.ai.auth

import android.util.Log
import com.faceattend.ai.BuildConfig
import org.json.JSONObject
import java.io.PrintWriter
import java.io.StringWriter
import java.net.HttpURLConnection
import java.net.URL

private const val AUTH_DEBUG_TAG = "FACEATTEND_AUTH_DEBUG"
private const val MAX_SAFE_DIAGNOSTIC_LENGTH = 300

/** Temporary redacted diagnostics for the device setup authentication flow. */
object AuthDiagnostics {
    const val TAG = AUTH_DEBUG_TAG

    fun log(message: String) {
        Log.d(TAG, message)
    }

    fun logException(stage: String, exception: Throwable) {
        Log.e(TAG, "${stage}_EXCEPTION=${exception.javaClass.name}")
        Log.e(TAG, "${stage}_MESSAGE=${safeExceptionMessage(exception)}")
        Log.e(TAG, "${stage}_STACK_TRACE=${safeStackTrace(exception)}")
    }

    fun safeExceptionMessage(exception: Throwable): String = sanitize(
        exception.message ?: exception.javaClass.simpleName,
    )

    fun safeDiagnostic(exception: Throwable): String = when (exception) {
        is DeviceAuthException -> exception.safeDiagnostic
        else -> "Authentication failed: ${exception.javaClass.simpleName} - " +
            safeExceptionMessage(exception)
    }

    fun safeAuthError(payload: JSONObject): String {
        val fields = listOf("error", "error_code", "message", "error_description")
            .mapNotNull { name ->
                payload.optString(name).takeIf { it.isNotBlank() }?.let {
                    "$name=${sanitize(it)}"
                }
            }
        return fields.joinToString("; ").ifBlank { "none" }
    }

    private fun safeStackTrace(exception: Throwable): String {
        val writer = StringWriter()
        exception.printStackTrace(PrintWriter(writer))
        return sanitize(writer.toString(), maxLength = 2_000)
    }

    private fun sanitize(value: String, maxLength: Int = MAX_SAFE_DIAGNOSTIC_LENGTH): String =
        value
            .replace(Regex("(?i)https?://[^\\s\\\"]+"), "<redacted-url>")
            .replace(
                Regex("(?i)(password|access_token|refresh_token|apikey|authorization)[=:][^\\s,;]+"),
                "$1=<redacted>",
            )
            .replace(Regex("[\\r\\n]+"), " ")
            .take(maxLength)
}

/** The only Android client that accepts device credentials, used by Device Setup only. */
class DeviceAuthClient(
    private val supabaseUrl: String = BuildConfig.SUPABASE_URL,
    private val anonKey: String = BuildConfig.SUPABASE_ANON_KEY,
) {
    fun signIn(email: String, password: String): DeviceSession {
        require(email.isNotBlank() && password.isNotEmpty()) { "Device credentials are required" }
        return authenticate(
            grantType = "password",
            body = JSONObject()
                .put("email", email.trim())
                .put("password", password)
                .toString(),
        )
    }

    fun refresh(refreshToken: String): DeviceSession {
        require(refreshToken.isNotBlank()) { "Refresh token is required" }
        return authenticate(
            grantType = "refresh_token",
            body = JSONObject().put("refresh_token", refreshToken).toString(),
        )
    }

    private fun authenticate(grantType: String, body: String): DeviceSession {
        val endpointPath = "/auth/v1/token?grant_type=$grantType"
        AuthDiagnostics.log("AUTH_START")
        AuthDiagnostics.log("CONFIG_URL=${if (supabaseUrl.startsWith("https://")) "configured" else "not_configured"}")
        AuthDiagnostics.log("CONFIG_PUBLIC_KEY=${if (anonKey.isNotBlank()) "configured" else "not_configured"}")
        AuthDiagnostics.log("ENDPOINT=$endpointPath")

        var connection: HttpURLConnection? = null
        try {
            require(supabaseUrl.startsWith("https://")) { "Supabase URL must use HTTPS" }
            require(anonKey.isNotBlank()) { "Supabase public configuration is missing" }

            connection = (URL(supabaseUrl.trimEnd('/') + endpointPath)
                .openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 15_000
                doInput = true
                doOutput = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("apikey", anonKey)
            }

            AuthDiagnostics.log("REQUEST_STARTED")
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            val status = connection.responseCode
            AuthDiagnostics.log("REQUEST_COMPLETED=true")
            AuthDiagnostics.log("HTTP_STATUS=$status")

            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val responseBody = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            AuthDiagnostics.log("RESPONSE_RECEIVED=${responseBody.isNotEmpty()}")
            AuthDiagnostics.log("RESPONSE_BODY_LENGTH=${responseBody.length}")

            val payload = try {
                JSONObject(responseBody).also {
                    AuthDiagnostics.log("RESPONSE_JSON=SUCCESS")
                }
            } catch (exception: Exception) {
                AuthDiagnostics.log("RESPONSE_JSON=FAILED")
                AuthDiagnostics.logException("RESPONSE_PARSE", exception)
                throw DeviceAuthException(
                    message = "Authentication response parsing failed",
                    safeDiagnostic = "Authentication response parsing failed",
                    cause = exception,
                )
            }

            if (status !in 200..299) {
                val safeError = AuthDiagnostics.safeAuthError(payload)
                AuthDiagnostics.log("AUTH_ERROR=$safeError")
                AuthDiagnostics.log("AUTH_RESULT=FAILED")
                throw DeviceAuthException(
                    message = "Device authentication failed",
                    safeDiagnostic = "Authentication failed: HTTP $status - $safeError",
                )
            }

            val accessTokenPresent = payload.optString("access_token").isNotBlank()
            val refreshTokenPresent = payload.optString("refresh_token").isNotBlank()
            val userPresent = payload.has("user") && !payload.isNull("user")
            AuthDiagnostics.log("ACCESS_TOKEN_PRESENT=$accessTokenPresent")
            AuthDiagnostics.log("REFRESH_TOKEN_PRESENT=$refreshTokenPresent")
            AuthDiagnostics.log("USER_PRESENT=$userPresent")

            AuthDiagnostics.log("SESSION_PARSE=START")
            val session = try {
                DeviceSession.fromAuthResponse(payload)
            } catch (exception: Exception) {
                AuthDiagnostics.logException("SESSION_PARSE", exception)
                throw DeviceAuthException(
                    message = "Authentication response parsing failed",
                    safeDiagnostic = "Authentication response parsing failed",
                    cause = exception,
                )
            }
            AuthDiagnostics.log("SESSION_PARSE=SUCCESS")
            AuthDiagnostics.log("AUTH_RESULT=SUCCESS")
            return session
        } catch (exception: DeviceAuthException) {
            AuthDiagnostics.log("AUTH_STOP=${exception.safeDiagnostic}")
            throw exception
        } catch (exception: Exception) {
            AuthDiagnostics.logException("AUTH", exception)
            AuthDiagnostics.log("AUTH_STOP=${exception.javaClass.simpleName}")
            throw DeviceAuthException(
                message = "Device authentication failed",
                safeDiagnostic = "Authentication failed: ${exception.javaClass.simpleName} - " +
                    AuthDiagnostics.safeExceptionMessage(exception),
                cause = exception,
            )
        } finally {
            connection?.disconnect()
            AuthDiagnostics.log("AUTH_CONNECTION_CLOSED")
        }
    }
}

class DeviceAuthException(
    message: String,
    val safeDiagnostic: String = message,
    cause: Throwable? = null,
) : IllegalStateException(message, cause)

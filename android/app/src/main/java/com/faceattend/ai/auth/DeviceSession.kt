package com.faceattend.ai.auth

import org.json.JSONObject

data class DeviceSession(
    val accessToken: String,
    val refreshToken: String,
    val expiresAtEpochSeconds: Long,
) {
    fun isUsable(nowEpochSeconds: Long = System.currentTimeMillis() / 1_000L): Boolean =
        accessToken.isNotBlank() && expiresAtEpochSeconds > nowEpochSeconds + EXPIRY_SKEW_SECONDS

    fun toJson(): String = JSONObject()
        .put("access_token", accessToken)
        .put("refresh_token", refreshToken)
        .put("expires_at", expiresAtEpochSeconds)
        .toString()

    companion object {
        private const val EXPIRY_SKEW_SECONDS = 30L

        fun fromAuthResponse(payload: JSONObject): DeviceSession {
            val accessToken = payload.optString("access_token")
            val refreshToken = payload.optString("refresh_token")
            val expiresIn = payload.optLong("expires_in", 3_600L)
            val expiresAt = payload.optLong("expires_at").takeIf { it > 0L }
                ?: (System.currentTimeMillis() / 1_000L + expiresIn)
            require(accessToken.isNotBlank() && refreshToken.isNotBlank()) {
                "Device authentication response did not contain a session"
            }
            return DeviceSession(accessToken, refreshToken, expiresAt)
        }

        fun fromStoredJson(json: String): DeviceSession {
            val payload = JSONObject(json)
            return DeviceSession(
                accessToken = payload.getString("access_token"),
                refreshToken = payload.getString("refresh_token"),
                expiresAtEpochSeconds = payload.getLong("expires_at"),
            )
        }
    }
}

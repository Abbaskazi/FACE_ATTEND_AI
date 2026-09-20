package com.faceattend.ai.auth

import android.content.Context

class DeviceSessionManager(context: Context) {
    private val store = DeviceSessionStore(context.applicationContext)
    private val authClient = DeviceAuthClient()
    private var session: DeviceSession? = null

    @Synchronized
    fun restore(): DeviceSession? {
        session = store.load()
        return session
    }

    @Synchronized
    fun hasUsableSession(): Boolean = session?.isUsable() == true

    @Synchronized
    fun hasSession(): Boolean = session != null

    @Synchronized
    fun signIn(email: String, password: String): DeviceSession {
        val newSession = authClient.signIn(email, password)
        AuthDiagnostics.log("SESSION_STORE=START")
        try {
            store.save(newSession)
        } catch (exception: Exception) {
            AuthDiagnostics.logException("SESSION_STORE", exception)
            val diagnostic = "Session persistence failed: ${exception.javaClass.simpleName} - " +
                AuthDiagnostics.safeExceptionMessage(exception)
            AuthDiagnostics.log("AUTH_STOP=$diagnostic")
            throw DeviceAuthException(
                message = "Device session persistence failed",
                safeDiagnostic = diagnostic,
                cause = exception,
            )
        }
        AuthDiagnostics.log("SESSION_STORE=SUCCESS")
        session = newSession
        AuthDiagnostics.log("SESSION_MANAGER_SIGN_IN=SUCCESS")
        return newSession
    }

    @Synchronized
    fun getValidAccessToken(): String? {
        val current = session ?: store.load()?.also { session = it } ?: return null
        if (current.isUsable()) return current.accessToken
        return runCatching {
            authClient.refresh(current.refreshToken).also {
                AuthDiagnostics.log("SESSION_STORE=START")
                store.save(it)
                AuthDiagnostics.log("SESSION_STORE=SUCCESS")
                session = it
            }
        }.getOrElse {
            AuthDiagnostics.logException("SESSION_REFRESH", it)
            clear()
            null
        }?.accessToken
    }

    @Synchronized
    fun clear() {
        session = null
        store.clear()
    }
}

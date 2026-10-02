package com.faceattend.ai.enrollment

/** Pure session-isolation checks shared by the UI and deterministic tests. */
object EnrollmentCaptureGuard {
    fun isCurrent(readyGeneration: String?, currentGeneration: String): Boolean =
        !readyGeneration.isNullOrBlank() && readyGeneration == currentGeneration
}

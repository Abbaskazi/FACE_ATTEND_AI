package com.faceattend.ai

import android.app.Application
import com.faceattend.ai.auth.DeviceSessionManager
import com.faceattend.ai.diagnostics.RecognitionLogRepository
import com.faceattend.ai.diagnostics.EnrollmentInputDiagnosticRepository

class FaceAttendApplication : Application() {
    lateinit var deviceSessionManager: DeviceSessionManager
        private set
    lateinit var recognitionLogRepository: RecognitionLogRepository
        private set
    lateinit var enrollmentInputDiagnosticRepository: EnrollmentInputDiagnosticRepository
        private set

    override fun onCreate() {
        super.onCreate()
        deviceSessionManager = DeviceSessionManager(this)
        recognitionLogRepository = RecognitionLogRepository(this)
        enrollmentInputDiagnosticRepository = EnrollmentInputDiagnosticRepository(this)
    }
}

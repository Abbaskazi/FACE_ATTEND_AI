package com.faceattend.ai

import android.app.Application
import com.faceattend.ai.auth.DeviceSessionManager

class FaceAttendApplication : Application() {
    lateinit var deviceSessionManager: DeviceSessionManager
        private set

    override fun onCreate() {
        super.onCreate()
        deviceSessionManager = DeviceSessionManager(this)
    }
}

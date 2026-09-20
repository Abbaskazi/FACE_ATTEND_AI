package com.faceattend.ai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.faceattend.ai.ui.FaceAttendApp
import com.faceattend.ai.ui.theme.FaceAttendTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            FaceAttendTheme {
                FaceAttendApp()
            }
        }
    }
}

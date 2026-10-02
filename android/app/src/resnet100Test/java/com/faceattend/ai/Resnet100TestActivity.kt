package com.faceattend.ai

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.faceattend.ai.ui.resnet100.Resnet100TestScreen
import com.faceattend.ai.ui.theme.FaceAttendTheme

class Resnet100TestActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            FaceAttendTheme {
                Resnet100TestScreen()
            }
        }
    }
}

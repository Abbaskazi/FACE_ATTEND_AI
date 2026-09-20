package com.faceattend.ai.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable

private val FaceAttendColors = lightColorScheme(
    primary = BluePrimary,
    secondary = BlueDark,
    tertiary = BlueLight,
)

@Composable
fun FaceAttendTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = FaceAttendColors,
        content = content,
    )
}

package com.faceattend.ai.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun HomeScreen(onStartAttendance: () -> Unit, onStartEnrollment: () -> Unit) {
    Scaffold { paddingValues ->
        Column(
            modifier = Modifier.fillMaxSize().padding(paddingValues).padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("FaceAttend AI", style = MaterialTheme.typography.headlineLarge)
            Text(
                text = "Employee attendance",
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.padding(top = 8.dp, bottom = 32.dp),
            )
            Button(onClick = onStartAttendance) {
                Text("Attendance")
            }
            Button(onClick = onStartEnrollment, modifier = Modifier.padding(top = 12.dp)) {
                Text("Enroll employee")
            }
        }
    }
}

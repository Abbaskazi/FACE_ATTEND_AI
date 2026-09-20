package com.faceattend.ai.ui.device

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.faceattend.ai.auth.AuthDiagnostics
import com.faceattend.ai.auth.DeviceSessionManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun DeviceSetupScreen(
    sessionManager: DeviceSessionManager,
    onSetupSuccess: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var errorMessage by remember { mutableStateOf<String?>(null) }

    Scaffold(
        topBar = { TopAppBar(title = { Text("Device setup") }) },
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
                .padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text("Device setup required", style = MaterialTheme.typography.headlineSmall)
            Text(
                "Sign in once with the provisioned attendance-device account. The password is used only for this setup and is never stored.",
                modifier = Modifier.padding(top = 12.dp, bottom = 20.dp),
            )
            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text("Device email") },
                singleLine = true,
                enabled = !loading,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text("Device password") },
                singleLine = true,
                enabled = !loading,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
            )
            Button(
                enabled = !loading && email.isNotBlank() && password.isNotEmpty(),
                onClick = {
                    loading = true
                    errorMessage = null
                    scope.launch {
                        val result = withContext(Dispatchers.IO) {
                            runCatching { sessionManager.signIn(email, password) }
                        }
                        password = ""
                        result.onSuccess { onSetupSuccess() }
                            .onFailure {
                                val diagnostic = AuthDiagnostics.safeDiagnostic(it)
                                AuthDiagnostics.log("UI_AUTH_FAILURE=$diagnostic")
                                errorMessage = diagnostic
                            }
                        loading = false
                    }
                },
                modifier = Modifier.padding(top = 20.dp),
            ) {
                Text(if (loading) "Setting up..." else "Complete device setup")
            }
            errorMessage?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        }
    }
}

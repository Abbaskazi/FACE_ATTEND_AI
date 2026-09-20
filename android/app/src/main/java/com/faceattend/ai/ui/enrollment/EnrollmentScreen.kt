package com.faceattend.ai.ui.enrollment

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
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
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.faceattend.ai.BuildConfig
import com.faceattend.ai.auth.DeviceSessionManager
import com.faceattend.ai.camera.CameraPreview
import com.faceattend.ai.enrollment.EnrollmentApiClient
import com.faceattend.ai.enrollment.EnrollmentApiException
import com.faceattend.ai.enrollment.EnrollmentSubmitResult
import com.faceattend.ai.enrollment.enrollmentMessage
import com.faceattend.ai.face.FaceDetectionState
import com.faceattend.ai.face.embedding.FaceEmbedding
import com.faceattend.ai.face.embedding.FaceEmbeddingModel
import com.faceattend.ai.face.embedding.OnnxFaceEmbeddingModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun EnrollmentScreen(
    sessionManager: DeviceSessionManager,
    onBack: () -> Unit,
    onEnrollmentSuccess: () -> Unit,
    onSetupRequired: () -> Unit,
) {
    val context = LocalContext.current
    val apiClient = remember { EnrollmentApiClient() }
    val scope = rememberCoroutineScope()
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var sessionToken by remember { mutableStateOf("") }
    var resultMessage by remember { mutableStateOf<String?>(null) }
    var submitting by remember { mutableStateOf(false) }
    var submitted by remember { mutableStateOf(false) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var detectionState by remember { mutableStateOf(FaceDetectionState()) }
    var latestEmbedding by remember { mutableStateOf<FaceEmbedding?>(null) }
    var embeddingModel by remember { mutableStateOf<FaceEmbeddingModel?>(null) }
    var modelLoading by remember { mutableStateOf(true) }
    var modelError by remember { mutableStateOf(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCameraPermission = granted }

    LaunchedEffect(Unit) {
        if (!sessionManager.hasSession()) onSetupRequired()
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            modelLoading = false
            return@LaunchedEffect
        }
        val result = withContext(Dispatchers.Default) {
            runCatching { OnnxFaceEmbeddingModel(context.applicationContext) }
        }
        result.onSuccess {
            embeddingModel = it
            modelLoading = false
        }.onFailure { error ->
            Log.e("FaceAttendModel", "Face model initialization failed", error)
            modelError = true
            modelLoading = false
        }
    }

    val currentEmbeddingModel = rememberUpdatedState(embeddingModel)
    DisposableEffect(Unit) {
        onDispose { currentEmbeddingModel.value?.close() }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                title = { Text("Enroll employee") },
            )
        },
    ) { paddingValues ->
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            Text(
                "Enrollment backend is not configured for this build",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(paddingValues).padding(24.dp),
            )
            return@Scaffold
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(paddingValues).padding(horizontal = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (!sessionManager.hasSession()) {
                Text(
                    "Device setup required",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 24.dp),
                )
                return@Column
            }

            OutlinedTextField(
                value = sessionToken,
                onValueChange = {
                    sessionToken = it
                    resultMessage = null
                    submitted = false
                },
                label = { Text("Admin enrollment token") },
                supportingText = { Text("Use the one-time token created for this employee") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )

            Box(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    sessionToken.isBlank() -> Text("Enter the admin enrollment token to open the camera")
                    modelLoading -> Text("Loading face model...")
                    modelError -> Text("Face model unavailable", color = MaterialTheme.colorScheme.error)
                    !hasCameraPermission -> Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                        Text("Allow camera")
                    }
                    embeddingModel != null -> CameraPreview(
                        modifier = Modifier.fillMaxSize(),
                        embeddingModel = embeddingModel!!,
                        onStateChanged = { detectionState = it },
                        onCameraError = { cameraError = it },
                        onEmbeddingReady = { embedding, _ -> latestEmbedding = embedding },
                    )
                }
                cameraError?.let {
                    Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(24.dp))
                }
            }

            Text(
                detectionState.enrollmentMessage(),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 8.dp),
            )
            resultMessage?.let {
                Text(
                    it,
                    color = if (submitted) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            Button(
                enabled = latestEmbedding != null && !submitting && !submitted,
                onClick = {
                    val embedding = latestEmbedding ?: return@Button
                    submitting = true
                    resultMessage = null
                    scope.launch {
                        val accessToken = withContext(Dispatchers.IO) {
                            sessionManager.getValidAccessToken()
                        }
                        if (accessToken == null) {
                            sessionManager.clear()
                            submitting = false
                            onSetupRequired()
                            return@launch
                        }
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                apiClient.submitEnrollment(accessToken, sessionToken, embedding.values.copyOf())
                            }
                        }
                        result.onSuccess { outcome ->
                            when (outcome) {
                                is EnrollmentSubmitResult.Success -> {
                                    submitted = true
                                    resultMessage = "Enrollment successful"
                                    onEnrollmentSuccess()
                                }
                                is EnrollmentSubmitResult.Failure -> {
                                    resultMessage = outcome.message
                                    if (outcome.authenticationFailure) {
                                        sessionManager.clear()
                                        onSetupRequired()
                                    }
                                }
                            }
                        }.onFailure {
                            resultMessage = if (it is EnrollmentApiException) {
                                it.message
                            } else {
                                "Enrollment could not be completed"
                            }
                        }
                        submitting = false
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 16.dp),
            ) { Text(if (submitting) "Enrolling..." else "Complete enrollment") }
        }
    }
}

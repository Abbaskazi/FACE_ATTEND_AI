package com.faceattend.ai.ui.attendance

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
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
import com.faceattend.ai.attendance.AttendanceApiClient
import com.faceattend.ai.attendance.AttendanceApiException
import com.faceattend.ai.attendance.AttendanceOutcome
import com.faceattend.ai.attendance.AttendanceSubmitResult
import com.faceattend.ai.auth.DeviceSessionManager
import com.faceattend.ai.camera.CameraPreview
import com.faceattend.ai.domain.FaceGateStatus
import com.faceattend.ai.face.FaceDetectionState
import com.faceattend.ai.face.LivenessStatus
import com.faceattend.ai.face.embedding.FaceEmbedding
import com.faceattend.ai.face.embedding.FaceEmbeddingModel
import com.faceattend.ai.face.embedding.OnnxFaceEmbeddingModel
import com.faceattend.ai.face.liveness.FaceLivenessModel
import com.faceattend.ai.face.liveness.OnnxFaceLivenessModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

private data class AttendanceSuccess(
    val employeeName: String,
    val employeeCode: String,
    val checkInTime: String,
)

private const val ATTENDANCE_DEBUG_TAG = "FACEATTEND_ATTENDANCE_DEBUG"

private fun safeAttendanceExceptionSummary(error: Throwable): String {
    val message = error.message
        ?.replace(
            Regex("(?i)(access_token|refresh_token|authorization|apikey|service[-_ ]role|password|embedding)\\s*[:=]\\s*[^,;\\s]+"),
            "$1=<redacted>",
        )
        ?.replace(Regex("[\\r\\n]+"), " ")
        ?.take(160)
        .orEmpty()
        .ifBlank { "no message" }
    return "${error.javaClass.simpleName} - $message"
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun AttendanceScreen(
    sessionManager: DeviceSessionManager,
    onBack: () -> Unit,
    onSetupRequired: () -> Unit,
) {
    val context = LocalContext.current
    val apiClient = remember { AttendanceApiClient() }
    val scope = rememberCoroutineScope()
    val submissionGate = remember { AtomicBoolean(false) }
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var detectionState by remember { mutableStateOf(FaceDetectionState()) }
    var embeddingModel by remember { mutableStateOf<FaceEmbeddingModel?>(null) }
    var livenessModel by remember { mutableStateOf<FaceLivenessModel?>(null) }
    var modelError by remember { mutableStateOf(false) }
    var modelLoading by remember { mutableStateOf(true) }
    var submitting by remember { mutableStateOf(false) }
    var attendanceMessage by remember { mutableStateOf<String?>(null) }
    var success by remember { mutableStateOf<AttendanceSuccess?>(null) }
    var pendingRequestId by remember { mutableStateOf<String?>(null) }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCameraPermission = granted }

    LaunchedEffect(Unit) {
        if (!sessionManager.hasSession()) onSetupRequired()
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
        val result = withContext(Dispatchers.Default) {
            runCatching {
                val arcFace = OnnxFaceEmbeddingModel(context.applicationContext)
                runCatching { arcFace to OnnxFaceLivenessModel(context.applicationContext) }
                    .getOrElse { error ->
                        arcFace.close()
                        throw error
                    }
            }
        }
        result.onSuccess { (arcFace, liveness) ->
            embeddingModel = arcFace
            livenessModel = liveness
            modelLoading = false
        }.onFailure { error ->
            Log.e("FaceAttendModel", "Face/liveness model initialization failed", error)
            modelError = true
            modelLoading = false
        }
    }

    val currentEmbeddingModel = rememberUpdatedState(embeddingModel)
    val currentLivenessModel = rememberUpdatedState(livenessModel)
    DisposableEffect(Unit) {
        onDispose {
            currentEmbeddingModel.value?.close()
            currentLivenessModel.value?.close()
        }
    }

    fun submitEmbedding(embedding: FaceEmbedding) {
        if (!submissionGate.compareAndSet(false, true)) return
        submitting = true
        attendanceMessage = null
        success = null
        val requestId = UUID.randomUUID().toString()
        pendingRequestId = requestId
        Log.d(
            ATTENDANCE_DEBUG_TAG,
            "SCREEN_SUBMIT_STARTED request_id=$requestId embeddingPresent=true " +
                "embeddingDimension=${embedding.values.size}",
        )
        scope.launch {
            val accessToken = withContext(Dispatchers.IO) {
                sessionManager.getValidAccessToken()
            }
            Log.d(
                ATTENDANCE_DEBUG_TAG,
                "SESSION_TOKEN_CHECK accessTokenPresent=${accessToken != null}",
            )
            if (accessToken == null) {
                Log.d(ATTENDANCE_DEBUG_TAG, "SESSION_TOKEN_CHECK=FAILED setupRequired=true")
                sessionManager.clear()
                submitting = false
                submissionGate.set(false)
                onSetupRequired()
                return@launch
            }
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    apiClient.submitCheckIn(accessToken, requestId, embedding.values.copyOf())
                }
            }
            result.onSuccess { outcome ->
                Log.d(
                    ATTENDANCE_DEBUG_TAG,
                    "SCREEN_RESULT_CALLBACK=REACHED resultType=${outcome.javaClass.simpleName}",
                )
                when (outcome) {
                    is AttendanceSubmitResult.Success -> {
                        Log.d(
                            ATTENDANCE_DEBUG_TAG,
                            "SCREEN_RESULT_SUCCESS outcome=${outcome.outcome} " +
                                "employeeIdentified=${outcome.employeeCode != null || outcome.employeeName != null}",
                        )
                        pendingRequestId = null
                        if (outcome.outcome == AttendanceOutcome.NOT_RECORDED) {
                            attendanceMessage = "Employee not identified"
                        } else {
                            attendanceMessage = "Attendance Marked"
                            success = AttendanceSuccess(
                                employeeName = outcome.employeeName ?: "Unavailable",
                                employeeCode = outcome.employeeCode ?: "Unavailable",
                                checkInTime = outcome.serverTime ?: "Unavailable",
                            )
                        }
                    }
                    is AttendanceSubmitResult.Failure -> {
                        Log.d(
                            ATTENDANCE_DEBUG_TAG,
                            "SCREEN_RESULT_FAILURE authenticationFailure=${outcome.authenticationFailure} " +
                                "diagnostic=${outcome.diagnosticSummary ?: "unavailable"}",
                        )
                        attendanceMessage = outcome.message
                        outcome.diagnosticSummary?.let {
                            attendanceMessage = "Attendance failed: $it"
                        }
                        if (outcome.authenticationFailure) {
                            sessionManager.clear()
                            onSetupRequired()
                        }
                    }
                }
            }.onFailure {
                val summary = safeAttendanceExceptionSummary(it)
                Log.e(
                    ATTENDANCE_DEBUG_TAG,
                    "SCREEN_EXCEPTION class=${it.javaClass.name} message=$summary",
                )
                attendanceMessage = "Attendance failed: $summary"
            }
            submitting = false
            submissionGate.set(false)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                title = { Text("Attendance") },
            )
        },
    ) { paddingValues ->
        if (!hasCameraPermission) {
            PermissionContent(
                modifier = Modifier.fillMaxSize().padding(paddingValues),
                onRequestPermission = { permissionLauncher.launch(Manifest.permission.CAMERA) },
            )
            return@Scaffold
        }

        Column(
            modifier = Modifier.fillMaxSize().padding(paddingValues),
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

            Box(
                modifier = Modifier.fillMaxWidth().weight(1f),
                contentAlignment = Alignment.Center,
            ) {
                when {
                    modelLoading -> Text("Loading face models...")
                    modelError -> Text("Face model unavailable", color = MaterialTheme.colorScheme.error)
                    embeddingModel != null && livenessModel != null -> CameraPreview(
                        modifier = Modifier.fillMaxSize(),
                        embeddingModel = embeddingModel!!,
                        livenessModel = livenessModel!!,
                        onStateChanged = { state ->
                            detectionState = state
                            if (state.livenessStatus == LivenessStatus.COLLECTING &&
                                state.livenessProgress <= 5
                            ) {
                                success = null
                                attendanceMessage = null
                            }
                        },
                        onCameraError = { cameraError = it },
                        onEmbeddingReady = { embedding, _ -> submitEmbedding(embedding) },
                    )
                }
                cameraError?.let {
                    Text(
                        text = it,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(24.dp),
                    )
                }
            }

            Text(
                text = detectionState.attendanceMessage(),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.padding(top = 12.dp),
            )
            if (detectionState.livenessStatus == LivenessStatus.COLLECTING) {
                LinearProgressIndicator(
                    progress = { detectionState.livenessProgress / 100f },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                )
                Text(
                    "${detectionState.livenessProgress}%",
                    style = MaterialTheme.typography.labelLarge,
                )
            }
            if (submitting) {
                Text("Recognizing employee...", modifier = Modifier.padding(top = 8.dp))
            }
            attendanceMessage?.let {
                Text(
                    text = it,
                    color = if (success != null) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 8.dp),
                )
            }
            success?.let { result ->
                Card(modifier = Modifier.fillMaxWidth().padding(12.dp)) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text("Attendance Marked Successfully", style = MaterialTheme.typography.titleMedium)
                        Text(
                            "Employee Name",
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(top = 12.dp),
                        )
                        Text(result.employeeName, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Employee ID",
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text(result.employeeCode, style = MaterialTheme.typography.bodyLarge)
                        Text(
                            "Check-in Time",
                            style = MaterialTheme.typography.labelLarge,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                        Text(result.checkInTime, style = MaterialTheme.typography.bodyLarge)
                    }
                }
            }
        }
    }
}

@Composable
private fun PermissionContent(modifier: Modifier, onRequestPermission: () -> Unit) {
    Column(
        modifier = modifier.padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("Camera permission is required for attendance")
        Button(
            onClick = onRequestPermission,
            modifier = Modifier.padding(top = 16.dp),
        ) {
            Text("Allow camera")
        }
    }
}

private fun FaceDetectionState.attendanceMessage(): String = when {
    errorMessage != null -> errorMessage
    livenessStatus == LivenessStatus.COLLECTING -> "Keep your face on camera"
    livenessStatus == LivenessStatus.PASSED && !embeddingReady -> "Liveness verified"
    embeddingReady -> "Recognizing employee..."
    else -> status.message()
}

private fun FaceGateStatus.message(): String = when (this) {
    FaceGateStatus.NO_FACE -> "No face detected"
    FaceGateStatus.SINGLE_FACE -> "Keep your face on camera"
    FaceGateStatus.MULTIPLE_FACES -> "Only one person can scan at a time"
}

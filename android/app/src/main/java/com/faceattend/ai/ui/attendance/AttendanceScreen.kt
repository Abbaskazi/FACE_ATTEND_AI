package com.faceattend.ai.ui.attendance

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
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
import com.faceattend.ai.attendance.AttendanceAction
import com.faceattend.ai.attendance.AttendanceOutcome
import com.faceattend.ai.attendance.AttendanceSubmitResult
import com.faceattend.ai.auth.DeviceSessionManager
import com.faceattend.ai.camera.CameraPreview
import com.faceattend.ai.diagnostics.RecognitionLogFactory
import com.faceattend.ai.diagnostics.RecognitionLogRepository
import com.faceattend.ai.diagnostics.RecognitionLogResult
import com.faceattend.ai.diagnostics.RecognitionOperation
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
    val outcome: AttendanceOutcome,
    val employeeName: String,
    val employeeCode: String,
    val checkInTime: String?,
    val checkOutTime: String?,
    val sessionWorkingMinutes: Int?,
    val todayTotalWorkingMinutes: Int?,
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
    recognitionLogRepository: RecognitionLogRepository,
    action: AttendanceAction,
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
    val operationStartedAt = remember { SystemClock.elapsedRealtime() }
    val cameraErrorLogged = remember { AtomicBoolean(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCameraPermission = granted }

    fun recordAttendance(
        result: RecognitionLogResult,
        embeddingGenerated: Boolean,
        employeeCode: String? = null,
        employeeName: String? = null,
        diagnostic: com.faceattend.ai.attendance.AttendanceDiagnosticSummary? = null,
        errorCode: String? = null,
        errorMessage: String? = null,
    ) {
        val diagnosticInfo = diagnostic?.let {
            listOfNotNull(
                it.decision?.let { value -> "decision=$value" },
                it.candidateCount?.let { value -> "candidateCount=$value" },
                it.normalizationStatus?.let { value -> "normalizationStatus=$value" },
            ).joinToString(", ").ifBlank { null }
        }
        runCatching {
            recognitionLogRepository.record(
                RecognitionLogFactory.create(
                    operation = if (action == AttendanceAction.CHECK_IN) {
                        RecognitionOperation.CHECK_IN
                    } else {
                        RecognitionOperation.CHECK_OUT
                    },
                    result = result,
                    startedAtElapsedRealtime = operationStartedAt,
                    state = detectionState,
                    embeddingGenerated = embeddingGenerated,
                    employeeCode = employeeCode,
                    employeeName = employeeName,
                    candidateCount = diagnostic?.candidateCount,
                    topCandidate = diagnostic?.topEmployeeCode ?: employeeCode,
                    topScore = diagnostic?.topScore,
                    secondScore = diagnostic?.secondScore,
                    margin = diagnostic?.scoreMargin,
                    threshold = diagnostic?.threshold,
                    ambiguityMargin = diagnostic?.ambiguityMargin,
                    errorCode = errorCode,
                    errorMessage = errorMessage,
                    diagnosticInfo = diagnosticInfo,
                ),
            )
        }
    }

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
            recordAttendance(
                result = RecognitionLogResult.ERROR,
                embeddingGenerated = false,
                errorCode = "MODEL_INITIALIZATION_FAILED",
                errorMessage = error.message,
            )
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
                recordAttendance(
                    result = RecognitionLogResult.ERROR,
                    embeddingGenerated = true,
                    errorCode = "SESSION_MISSING",
                    errorMessage = "Device session is unavailable",
                )
                Log.d(ATTENDANCE_DEBUG_TAG, "SESSION_TOKEN_CHECK=FAILED setupRequired=true")
                sessionManager.clear()
                submitting = false
                submissionGate.set(false)
                onSetupRequired()
                return@launch
            }
            val result = withContext(Dispatchers.IO) {
                runCatching {
                    apiClient.submit(accessToken, requestId, embedding.values.copyOf(), action)
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
                        val employeeName = outcome.employeeName
                        val employeeCode = outcome.employeeCode
                        recordAttendance(
                            result = when (outcome.outcome) {
                                AttendanceOutcome.AMBIGUOUS_MATCH -> RecognitionLogResult.AMBIGUOUS
                                AttendanceOutcome.RECOGNITION_FAILED -> RecognitionLogResult.FAILED
                                AttendanceOutcome.NOT_RECORDED -> RecognitionLogResult.FAILED
                                else -> RecognitionLogResult.SUCCESS
                            },
                            embeddingGenerated = true,
                            employeeCode = employeeCode,
                            employeeName = employeeName,
                            diagnostic = outcome.diagnostic,
                        )
                        when (outcome.outcome) {
                            AttendanceOutcome.RECOGNITION_FAILED ->
                                attendanceMessage = "Employee could not be recognized."
                            AttendanceOutcome.AMBIGUOUS_MATCH ->
                                attendanceMessage = "Face could not be reliably recognized. Please try again."
                            AttendanceOutcome.NOT_RECORDED ->
                                attendanceMessage = "Attendance could not be recorded. Please try again."
                            AttendanceOutcome.ALREADY_CHECKED_IN -> {
                                attendanceMessage = "You are already checked in."
                                if (employeeName != null && employeeCode != null) {
                                    success = AttendanceSuccess(
                                        outcome = outcome.outcome,
                                        employeeName = employeeName,
                                        employeeCode = employeeCode,
                                        checkInTime = outcome.checkInTime,
                                        checkOutTime = null,
                                        sessionWorkingMinutes = null,
                                        todayTotalWorkingMinutes = outcome.todayTotalWorkingMinutes,
                                    )
                                }
                            }
                            AttendanceOutcome.NOT_CHECKED_IN -> {
                                attendanceMessage = "You are not checked in. Please check in first."
                                if (employeeName != null && employeeCode != null) {
                                    success = AttendanceSuccess(
                                        outcome = outcome.outcome,
                                        employeeName = employeeName,
                                        employeeCode = employeeCode,
                                        checkInTime = null,
                                        checkOutTime = null,
                                        sessionWorkingMinutes = null,
                                        todayTotalWorkingMinutes = outcome.todayTotalWorkingMinutes,
                                    )
                                }
                            }
                            AttendanceOutcome.CHECK_IN_RECORDED,
                            AttendanceOutcome.CHECK_OUT_RECORDED -> {
                                if (employeeName == null || employeeCode == null || outcome.serverTime == null) {
                                    attendanceMessage = "Attendance response was incomplete"
                                } else {
                                    attendanceMessage = if (outcome.outcome == AttendanceOutcome.CHECK_IN_RECORDED) {
                                        "Check-In Successful"
                                    } else {
                                        "Check-Out Successful"
                                    }
                                    success = AttendanceSuccess(
                                        outcome = outcome.outcome,
                                        employeeName = employeeName,
                                        employeeCode = employeeCode,
                                        checkInTime = outcome.checkInTime,
                                        checkOutTime = outcome.checkOutTime,
                                        sessionWorkingMinutes = outcome.sessionWorkingMinutes,
                                        todayTotalWorkingMinutes = outcome.todayTotalWorkingMinutes,
                                    )
                                }
                            }
                            else -> attendanceMessage = "Unable to process attendance. Please try again."
                        }
                    }
                    is AttendanceSubmitResult.Failure -> {
                        recordAttendance(
                            result = if (outcome.diagnostic?.decision == "AMBIGUOUS_MATCH") {
                                RecognitionLogResult.AMBIGUOUS
                            } else {
                                RecognitionLogResult.FAILED
                            },
                            embeddingGenerated = true,
                            employeeCode = outcome.diagnostic?.topEmployeeCode,
                            diagnostic = outcome.diagnostic,
                            errorCode = outcome.diagnostic?.decision ?: "ATTENDANCE_SUBMIT_FAILED",
                            errorMessage = outcome.message,
                        )
                        Log.d(
                            ATTENDANCE_DEBUG_TAG,
                            "SCREEN_RESULT_FAILURE authenticationFailure=${outcome.authenticationFailure} " +
                                "diagnostic=${outcome.diagnosticSummary ?: "unavailable"}",
                        )
                        attendanceMessage = outcome.message
                        if (outcome.authenticationFailure) {
                            sessionManager.clear()
                            onSetupRequired()
                        }
                    }
                }
            }.onFailure {
                recordAttendance(
                    result = RecognitionLogResult.ERROR,
                    embeddingGenerated = true,
                    errorCode = "ATTENDANCE_SUBMIT_ERROR",
                    errorMessage = it.message,
                )
                val summary = safeAttendanceExceptionSummary(it)
                Log.e(
                    ATTENDANCE_DEBUG_TAG,
                    "SCREEN_EXCEPTION class=${it.javaClass.name} message=$summary",
                )
                attendanceMessage = "Unable to connect to the attendance server. Please try again."
            }
            submitting = false
            submissionGate.set(false)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                title = { Text(if (action == AttendanceAction.CHECK_IN) "Check In" else "Check Out") },
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
                        onCameraError = {
                            cameraError = it
                            if (cameraErrorLogged.compareAndSet(false, true)) {
                                recordAttendance(
                                    result = RecognitionLogResult.ERROR,
                                    embeddingGenerated = false,
                                    errorCode = "CAMERA_ERROR",
                                    errorMessage = it,
                                )
                            }
                        },
                        onEmbeddingReady = { embedding, _, _ -> submitEmbedding(embedding) },
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
                        Text(
                            when (result.outcome) {
                                AttendanceOutcome.CHECK_IN_RECORDED -> "Check-In Successful"
                                AttendanceOutcome.CHECK_OUT_RECORDED -> "Check-Out Successful"
                                AttendanceOutcome.ALREADY_CHECKED_IN -> "Already Checked In"
                                AttendanceOutcome.NOT_CHECKED_IN -> "Cannot Check Out"
                                else -> "Attendance Result"
                            },
                            style = MaterialTheme.typography.titleMedium,
                        )
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
                        result.checkInTime?.let { checkInTime ->
                            Text(
                                "Check-in Time",
                                style = MaterialTheme.typography.labelLarge,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                            Text(checkInTime, style = MaterialTheme.typography.bodyLarge)
                        }
                        result.checkOutTime?.let { checkOutTime ->
                            Text(
                                "Check-out Time",
                                style = MaterialTheme.typography.labelLarge,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                            Text(checkOutTime, style = MaterialTheme.typography.bodyLarge)
                        }
                        result.sessionWorkingMinutes?.let { minutes ->
                            Text(
                                "Current Session",
                                style = MaterialTheme.typography.labelLarge,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                            Text(formatWorkingMinutes(minutes), style = MaterialTheme.typography.bodyLarge)
                        }
                        result.todayTotalWorkingMinutes?.let { minutes ->
                            Text(
                                "Today's Total",
                                style = MaterialTheme.typography.labelLarge,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                            Text(formatWorkingMinutes(minutes), style = MaterialTheme.typography.bodyLarge)
                        }
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

private fun formatWorkingMinutes(minutes: Int): String {
    val hours = minutes / 60
    val remainingMinutes = minutes % 60
    return "${hours}h ${remainingMinutes}m"
}

package com.faceattend.ai.ui.enrollment

import android.Manifest
import android.content.pm.PackageManager
import android.os.SystemClock
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
import com.faceattend.ai.diagnostics.EmbeddingProvenanceContext
import com.faceattend.ai.diagnostics.EmbeddingProvenanceEvent
import com.faceattend.ai.diagnostics.EmbeddingProvenanceLogger
import com.faceattend.ai.diagnostics.EmbeddingProvenanceStage
import com.faceattend.ai.diagnostics.RecognitionLogFactory
import com.faceattend.ai.diagnostics.RecognitionLogRepository
import com.faceattend.ai.diagnostics.RecognitionLogResult
import com.faceattend.ai.diagnostics.RecognitionOperation
import com.faceattend.ai.diagnostics.EnrollmentInputDiagnosticCapture
import com.faceattend.ai.diagnostics.EnrollmentInputDiagnosticRepository
import com.faceattend.ai.enrollment.EnrollmentCaptureGuard
import com.faceattend.ai.enrollment.EnrollmentApiClient
import com.faceattend.ai.enrollment.EnrollmentApiException
import com.faceattend.ai.enrollment.EnrollmentSubmitResult
import com.faceattend.ai.enrollment.enrollmentMessage
import com.faceattend.ai.face.FaceDetectionState
import com.faceattend.ai.face.embedding.FaceEmbedding
import com.faceattend.ai.face.embedding.FaceEmbeddingModel
import com.faceattend.ai.face.embedding.EmbeddingProvenanceHasher
import com.faceattend.ai.face.embedding.OnnxFaceEmbeddingModel
import com.faceattend.ai.face.liveness.FaceLivenessModel
import com.faceattend.ai.face.liveness.OnnxFaceLivenessModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun EnrollmentScreen(
    sessionManager: DeviceSessionManager,
    recognitionLogRepository: RecognitionLogRepository,
    onBack: () -> Unit,
    onEnrollmentSuccess: () -> Unit,
    onSetupRequired: () -> Unit,
) {
    val context = LocalContext.current
    val apiClient = remember { EnrollmentApiClient() }
    val enrollmentDiagnosticRepository = remember { EnrollmentInputDiagnosticRepository(context) }
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
    var latestEmbeddingHash by remember { mutableStateOf<String?>(null) }
    var latestEmbeddingGeneration by remember { mutableStateOf<String?>(null) }
    var enrollmentGeneration by remember { mutableStateOf(UUID.randomUUID().toString()) }
    var embeddingModel by remember { mutableStateOf<FaceEmbeddingModel?>(null) }
    var livenessModel by remember { mutableStateOf<FaceLivenessModel?>(null) }
    var modelLoading by remember { mutableStateOf(true) }
    var modelError by remember { mutableStateOf(false) }
    val operationStartedAt = remember { SystemClock.elapsedRealtime() }
    val cameraErrorLogged = remember { AtomicBoolean(false) }
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCameraPermission = granted }

    fun recordEnrollment(
        result: RecognitionLogResult,
        embeddingGenerated: Boolean = latestEmbedding != null,
        errorCode: String? = null,
        errorMessage: String? = null,
    ) {
        runCatching {
            recognitionLogRepository.record(
                RecognitionLogFactory.create(
                    operation = RecognitionOperation.ENROLLMENT,
                    result = result,
                    startedAtElapsedRealtime = operationStartedAt,
                    state = detectionState,
                    embeddingGenerated = embeddingGenerated,
                    errorCode = errorCode,
                    errorMessage = errorMessage,
                ),
            )
        }
    }

    fun recordProvenance(
        event: EmbeddingProvenanceEvent,
        state: FaceDetectionState = FaceDetectionState(),
    ) {
        EmbeddingProvenanceLogger.record(
            repository = recognitionLogRepository,
            event = event,
            state = state,
        )
    }

    fun resetCapture(newGeneration: Boolean) {
        latestEmbedding = null
        latestEmbeddingHash = null
        latestEmbeddingGeneration = null
        detectionState = FaceDetectionState()
        submitted = false
        if (newGeneration) enrollmentGeneration = UUID.randomUUID().toString()
    }

    fun recordInputDiagnostic(capture: EnrollmentInputDiagnosticCapture) {
        val record = runCatching { enrollmentDiagnosticRepository.record(capture) }.getOrNull() ?: return
        runCatching {
            recognitionLogRepository.record(
                RecognitionLogFactory.create(
                    operation = RecognitionOperation.ENROLLMENT_INPUT_DIAGNOSTIC,
                    result = RecognitionLogResult.SUCCESS,
                    startedAtElapsedRealtime = operationStartedAt,
                    state = detectionState,
                    embeddingGenerated = true,
                    diagnosticInfo = "112x112 aligned RGB input; imageSha=${record.imageSha256}; tensorSha=${record.tensorSha256}",
                    enrollmentDiagnosticId = record.id,
                    enrollmentDiagnosticImageSha256 = record.imageSha256,
                    enrollmentDiagnosticTensorSha256 = record.tensorSha256,
                ),
            )
        }
    }

    LaunchedEffect(Unit) {
        if (!sessionManager.hasSession()) onSetupRequired()
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
        if (BuildConfig.SUPABASE_URL.isBlank() || BuildConfig.SUPABASE_ANON_KEY.isBlank()) {
            modelLoading = false
            return@LaunchedEffect
        }
        val result = withContext(Dispatchers.Default) {
            runCatching {
                val arcFace = OnnxFaceEmbeddingModel(context.applicationContext)
                runCatching {
                    arcFace to OnnxFaceLivenessModel(context.applicationContext)
                }.getOrElse { error ->
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
            recordEnrollment(
                result = RecognitionLogResult.ERROR,
                errorCode = "MODEL_INITIALIZATION_FAILED",
                errorMessage = error.message,
            )
            Log.e("FaceAttendModel", "Face model initialization failed", error)
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
                    if (it != sessionToken) resetCapture(newGeneration = true)
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
                    embeddingModel != null && livenessModel != null -> CameraPreview(
                        modifier = Modifier.fillMaxSize(),
                        embeddingModel = embeddingModel!!,
                        livenessModel = livenessModel!!,
                        onStateChanged = { detectionState = it },
                        onCameraError = {
                            cameraError = it
                            if (cameraErrorLogged.compareAndSet(false, true)) {
                                recordEnrollment(
                                    result = RecognitionLogResult.ERROR,
                                    errorCode = "CAMERA_ERROR",
                                    errorMessage = it,
                                )
                            }
                        },
                        sessionGeneration = enrollmentGeneration,
                        onEmbeddingDiagnosticReady = ::recordInputDiagnostic,
                        onEmbeddingReady = { embedding, _, readyGeneration ->
                            if (!EnrollmentCaptureGuard.isCurrent(readyGeneration, enrollmentGeneration)) return@CameraPreview
                            val hash = EmbeddingProvenanceHasher.sha256(embedding.values)
                            val generation = readyGeneration
                            latestEmbedding = embedding
                            latestEmbeddingHash = hash
                            latestEmbeddingGeneration = generation
                            recordProvenance(
                                event = EmbeddingProvenanceEvent(
                                    stage = EmbeddingProvenanceStage.EMBEDDING_READY,
                                    embeddingSha256 = hash,
                                    embeddingGeneration = generation,
                                    sessionTokenPresent = sessionToken.isNotBlank(),
                                ),
                                state = detectionState,
                            )
                        },
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
                    val embeddingGenerated = embedding.values.isNotEmpty()
                    val submitHash = EmbeddingProvenanceHasher.sha256(embedding.values)
                    val embeddingGenerationForSubmit = latestEmbeddingGeneration
                    val submitGeneration = enrollmentGeneration
                    val sessionTokenForSubmit = sessionToken.trim()
                    val sessionTokenPresentForSubmit = sessionToken.isNotBlank()
                    val hashMatchesReady = latestEmbeddingHash != null && latestEmbeddingHash == submitHash
                    val generationMatchesReady =
                        latestEmbeddingGeneration != null && latestEmbeddingGeneration == submitGeneration
                    if (!EnrollmentCaptureGuard.isCurrent(embeddingGenerationForSubmit, submitGeneration)) {
                        recordEnrollment(
                            result = RecognitionLogResult.ERROR,
                            embeddingGenerated = true,
                            errorCode = "ENROLLMENT_GENERATION_MISMATCH",
                            errorMessage = "The face capture belongs to a different enrollment session",
                        )
                        resetCapture(newGeneration = true)
                        return@Button
                    }
                    recordProvenance(
                        event = EmbeddingProvenanceEvent(
                            stage = EmbeddingProvenanceStage.SUBMIT_PREPARED,
                            embeddingSha256 = submitHash,
                            embeddingGeneration = embeddingGenerationForSubmit,
                            submitGeneration = submitGeneration,
                            sessionTokenPresent = sessionTokenPresentForSubmit,
                            hashMatchesReady = hashMatchesReady,
                            generationMatchesReady = generationMatchesReady,
                        ),
                        state = detectionState,
                    )
                    submitting = true
                    resultMessage = null
                    scope.launch {
                        val accessToken = withContext(Dispatchers.IO) {
                            sessionManager.getValidAccessToken()
                        }
                        if (accessToken == null) {
                            recordEnrollment(
                                result = RecognitionLogResult.ERROR,
                                embeddingGenerated = embeddingGenerated,
                                errorCode = "SESSION_MISSING",
                                errorMessage = "Device session is unavailable",
                            )
                            sessionManager.clear()
                            submitting = false
                            onSetupRequired()
                            return@launch
                        }
                        val result = withContext(Dispatchers.IO) {
                            runCatching {
                                apiClient.submitEnrollment(
                                    accessToken = accessToken,
                                    sessionToken = sessionTokenForSubmit,
                                    embedding = embedding.values.copyOf(),
                                    provenanceContext = EmbeddingProvenanceContext(
                                        embeddingGeneration = embeddingGenerationForSubmit,
                                        submitGeneration = submitGeneration,
                                        sessionTokenPresent = sessionTokenPresentForSubmit,
                                        hashMatchesReady = hashMatchesReady,
                                        generationMatchesReady = generationMatchesReady,
                                    ),
                                    onProvenanceEvent = { event -> recordProvenance(event) },
                                )
                            }
                        }
                        result.onSuccess { outcome ->
                            when (outcome) {
                            is EnrollmentSubmitResult.Success -> {
                                recordEnrollment(
                                    result = RecognitionLogResult.SUCCESS,
                                    embeddingGenerated = embeddingGenerated,
                                )
                                submitted = true
                                    resultMessage = "Enrollment successful"
                                    onEnrollmentSuccess()
                                }
                                is EnrollmentSubmitResult.Failure -> {
                                    recordEnrollment(
                                        result = RecognitionLogResult.FAILED,
                                        embeddingGenerated = embeddingGenerated,
                                        errorCode = "ENROLLMENT_SUBMIT_FAILED",
                                        errorMessage = outcome.message,
                                    )
                                    resultMessage = outcome.message
                                    resetCapture(newGeneration = true)
                                    if (outcome.authenticationFailure) {
                                        sessionManager.clear()
                                        onSetupRequired()
                                    }
                                }
                            }
                        }.onFailure {
                            recordEnrollment(
                                result = RecognitionLogResult.ERROR,
                                embeddingGenerated = embeddingGenerated,
                                errorCode = "ENROLLMENT_SUBMIT_ERROR",
                                errorMessage = it.message,
                            )
                            resultMessage = if (it is EnrollmentApiException) {
                                it.message
                            } else {
                                "Enrollment could not be completed"
                            }
                            resetCapture(newGeneration = true)
                        }
                        submitting = false
                    }
                },
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp, bottom = 16.dp),
            ) { Text(if (submitting) "Enrolling..." else "Complete enrollment") }
        }
    }
}

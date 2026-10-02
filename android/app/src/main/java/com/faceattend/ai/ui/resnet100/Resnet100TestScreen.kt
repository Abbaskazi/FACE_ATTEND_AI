package com.faceattend.ai.ui.resnet100

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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.compose.material3.ExperimentalMaterial3Api
import com.faceattend.ai.camera.CameraPreview
import com.faceattend.ai.face.FaceDetectionState
import com.faceattend.ai.face.LivenessStatus
import com.faceattend.ai.domain.FaceGateStatus
import com.faceattend.ai.face.embedding.FaceEmbedding
import com.faceattend.ai.face.embedding.FaceEmbeddingModel
import com.faceattend.ai.face.embedding.MODEL_ASSET_NAME
import com.faceattend.ai.face.embedding.MODEL_VERSION
import com.faceattend.ai.face.embedding.OnnxFaceEmbeddingModel
import com.faceattend.ai.face.liveness.FaceLivenessModel
import com.faceattend.ai.face.liveness.OnnxFaceLivenessModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlin.math.sqrt

private const val TAG = "FaceAttendResnet100Test"

private enum class TestEmployee(val label: String) {
    EMPLOYEE_1("Employee 1"),
    EMPLOYEE_2("Employee 2"),
}

private sealed interface TestOperation {
    data class Enroll(val employee: TestEmployee) : TestOperation
    data class Scan(val employee: TestEmployee) : TestOperation
}

private data class ScanResult(
    val actual: TestEmployee,
    val employee1Score: Double,
    val employee2Score: Double,
    val predicted: TestEmployee,
    val correct: Boolean,
    val margin: Double,
    val captureElapsedMs: Double,
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun Resnet100TestScreen() {
    val context = LocalContext.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
                PackageManager.PERMISSION_GRANTED,
        )
    }
    var embeddingModel by remember { mutableStateOf<FaceEmbeddingModel?>(null) }
    var livenessModel by remember { mutableStateOf<FaceLivenessModel?>(null) }
    var modelLoading by remember { mutableStateOf(true) }
    var modelError by remember { mutableStateOf<String?>(null) }
    var operation by remember { mutableStateOf<TestOperation?>(null) }
    var operationStartedAt by remember { mutableStateOf(0L) }
    var detectionState by remember { mutableStateOf(FaceDetectionState()) }
    var cameraError by remember { mutableStateOf<String?>(null) }
    var templates by remember { mutableStateOf<Map<TestEmployee, FloatArray>>(emptyMap()) }
    var results by remember { mutableStateOf<List<ScanResult>>(emptyList()) }
    val testScope = rememberCoroutineScope()
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted -> hasCameraPermission = granted }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) permissionLauncher.launch(Manifest.permission.CAMERA)
        val loaded = withContext(Dispatchers.Default) {
            runCatching {
                val recognizer = OnnxFaceEmbeddingModel(context.applicationContext)
                runCatching {
                    recognizer to OnnxFaceLivenessModel(context.applicationContext)
                }.getOrElse { error ->
                    recognizer.close()
                    throw error
                }
            }
        }
        loaded.onSuccess { (recognizer, liveness) ->
            embeddingModel = recognizer
            livenessModel = liveness
            modelLoading = false
            Log.i(TAG, "MODEL_READY asset=$MODEL_ASSET_NAME sha256=$MODEL_VERSION")
        }.onFailure { error ->
            modelError = error.message ?: error.javaClass.simpleName
            modelLoading = false
            Log.e(TAG, "MODEL_READY=false reason=${error.javaClass.simpleName}", error)
        }
    }

    DisposableEffect(Unit) {
        onDispose {
            embeddingModel?.close()
            livenessModel?.close()
        }
    }

    fun start(nextOperation: TestOperation) {
        cameraError = null
        detectionState = FaceDetectionState()
        operationStartedAt = System.nanoTime()
        operation = nextOperation
        Log.i(TAG, "OPERATION_STARTED type=${nextOperation.javaClass.simpleName}")
    }

    fun finishEmbedding(embedding: FaceEmbedding) {
        val currentOperation = operation ?: return
        val elapsedMs = (System.nanoTime() - operationStartedAt) / 1_000_000.0
        when (currentOperation) {
            is TestOperation.Enroll -> {
                templates = templates + (currentOperation.employee to embedding.values.copyOf())
                Log.i(
                    TAG,
                    "ENROLLMENT_CAPTURED employee=${currentOperation.employee.label} " +
                        "dimension=${embedding.values.size} normalized=true captureElapsedMs=$elapsedMs",
                )
            }
            is TestOperation.Scan -> {
                val employee1 = templates[TestEmployee.EMPLOYEE_1]
                val employee2 = templates[TestEmployee.EMPLOYEE_2]
                if (employee1 == null || employee2 == null) {
                    Log.w(TAG, "SCAN_REJECTED reason=missing_local_templates")
                } else {
                    val score1 = cosine(embedding.values, employee1)
                    val score2 = cosine(embedding.values, employee2)
                    val predicted = if (score1 >= score2) {
                        TestEmployee.EMPLOYEE_1
                    } else {
                        TestEmployee.EMPLOYEE_2
                    }
                    val genuine = if (currentOperation.employee == TestEmployee.EMPLOYEE_1) score1 else score2
                    val impostor = if (currentOperation.employee == TestEmployee.EMPLOYEE_1) score2 else score1
                    val result = ScanResult(
                        actual = currentOperation.employee,
                        employee1Score = score1,
                        employee2Score = score2,
                        predicted = predicted,
                        correct = predicted == currentOperation.employee,
                        margin = genuine - impostor,
                        captureElapsedMs = elapsedMs,
                    )
                    results = results + result
                    Log.i(
                        TAG,
                        "SCAN_RESULT actual=${result.actual.label} " +
                            "employee1Score=${"%.6f".format(result.employee1Score)} " +
                            "employee2Score=${"%.6f".format(result.employee2Score)} " +
                            "predicted=${result.predicted.label} correct=${result.correct} " +
                            "margin=${"%.6f".format(result.margin)} " +
                            "captureElapsedMs=${result.captureElapsedMs}",
                    )
                }
            }
        }
        // Let FaceAnalyzer finish its ML Kit completion callback before CameraPreview
        // is disposed; this is test-screen lifecycle isolation only.
        testScope.launch {
            delay(750)
            operation = null
        }
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text("ResNet100 Phase 3 Test") }) },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text("LOCAL TEST ONLY — no Supabase, enrollment, or attendance calls")
            Text("Model: glintr100.onnx / ResNet100@Glint360K")
            Text("SHA-256: $MODEL_VERSION", style = MaterialTheme.typography.bodySmall)

            when {
                modelLoading -> Text("Loading ResNet100 and liveness models...")
                modelError != null -> Text("Model unavailable: $modelError", color = MaterialTheme.colorScheme.error)
                !hasCameraPermission -> Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                    Text("Allow camera")
                }
                else -> {
                    Text("Each button captures exactly one live embedding.")
                    Button(
                        enabled = operation == null,
                        onClick = { start(TestOperation.Enroll(TestEmployee.EMPLOYEE_1)) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (templates.containsKey(TestEmployee.EMPLOYEE_1)) "Re-enroll Employee 1 (one sample)" else "Enroll Employee 1 (one sample)") }
                    Button(
                        enabled = operation == null,
                        onClick = { start(TestOperation.Enroll(TestEmployee.EMPLOYEE_2)) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(if (templates.containsKey(TestEmployee.EMPLOYEE_2)) "Re-enroll Employee 2 (one sample)" else "Enroll Employee 2 (one sample)") }
                    Button(
                        enabled = operation == null && templates.size == 2,
                        onClick = { start(TestOperation.Scan(TestEmployee.EMPLOYEE_1)) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Scan Employee 1") }
                    Button(
                        enabled = operation == null && templates.size == 2,
                        onClick = { start(TestOperation.Scan(TestEmployee.EMPLOYEE_2)) },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Scan Employee 2") }
                    OutlinedButton(
                        enabled = operation == null,
                        onClick = {
                            templates = emptyMap()
                            results = emptyList()
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text("Reset local test store") }
                }
            }

            if (operation != null && embeddingModel != null && livenessModel != null) {
                Text("Active: ${operationLabel(operation!!)}")
                Box(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                    CameraPreview(
                        modifier = Modifier.fillMaxWidth(),
                        embeddingModel = embeddingModel!!,
                        livenessModel = livenessModel!!,
                        onStateChanged = { detectionState = it },
                        onCameraError = { cameraError = it },
                        onEmbeddingReady = { embedding, _, _ -> finishEmbedding(embedding) },
                    )
                }
                Text(testStateMessage(detectionState))
                cameraError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                OutlinedButton(onClick = { operation = null }, modifier = Modifier.fillMaxWidth()) {
                    Text("Cancel capture")
                }
            }

            Text("Local templates: ${templates.size}/2")
            HorizontalDivider()
            Text("Scan results (${results.size})")
            results.forEachIndexed { index, result ->
                Text(
                    "#${index + 1} actual=${result.actual.label}, " +
                        "E1=${"%.6f".format(result.employee1Score)}, " +
                        "E2=${"%.6f".format(result.employee2Score)}, " +
                        "predicted=${result.predicted.label}, correct=${result.correct}, " +
                        "margin=${"%.6f".format(result.margin)}",
                )
            }
        }
    }
}

private fun operationLabel(operation: TestOperation): String = when (operation) {
    is TestOperation.Enroll -> "Enroll ${operation.employee.label}"
    is TestOperation.Scan -> "Scan ${operation.employee.label}"
}

private fun testStateMessage(state: FaceDetectionState): String = when {
    state.errorMessage != null -> state.errorMessage
    state.livenessStatus == LivenessStatus.COLLECTING -> "Keep your face in view (${state.livenessProgress}%)"
    state.livenessStatus == LivenessStatus.PASSED && !state.embeddingReady -> "Liveness passed; generating embedding"
    state.embeddingReady -> "Embedding captured"
    else -> when (state.status) {
        FaceGateStatus.NO_FACE -> "No face detected"
        FaceGateStatus.SINGLE_FACE -> "Keep your face in view"
        FaceGateStatus.MULTIPLE_FACES -> "Only one person can scan at a time"
    }
}

private fun cosine(left: FloatArray, right: FloatArray): Double {
    require(left.size == right.size) { "Test embeddings must have equal dimensions" }
    var dot = 0.0
    var leftNorm = 0.0
    var rightNorm = 0.0
    left.indices.forEach { index ->
        val leftValue = left[index].toDouble()
        val rightValue = right[index].toDouble()
        dot += leftValue * rightValue
        leftNorm += leftValue * leftValue
        rightNorm += rightValue * rightValue
    }
    return dot / (sqrt(leftNorm) * sqrt(rightNorm))
}

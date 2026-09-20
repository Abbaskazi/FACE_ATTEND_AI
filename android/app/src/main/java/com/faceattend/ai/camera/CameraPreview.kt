package com.faceattend.ai.camera

import android.util.Log
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.faceattend.ai.face.FaceAnalyzer
import com.faceattend.ai.face.FaceDetectionState
import com.faceattend.ai.face.alignment.ArcFaceAligner
import com.faceattend.ai.face.embedding.FaceEmbedding
import com.faceattend.ai.face.embedding.FaceEmbeddingModel
import com.faceattend.ai.face.liveness.FaceLivenessModel
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

private const val TAG = "FaceAttendCamera"

@Composable
fun CameraPreview(
    modifier: Modifier = Modifier,
    embeddingModel: FaceEmbeddingModel,
    livenessModel: FaceLivenessModel? = null,
    onStateChanged: (FaceDetectionState) -> Unit,
    onCameraError: (String) -> Unit,
    onEmbeddingReady: (FaceEmbedding, String) -> Unit = { _, _ -> },
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }
    val analysisExecutor = remember { Executors.newSingleThreadExecutor() }
    val currentStateCallback = rememberUpdatedState(onStateChanged)
    val currentCameraErrorCallback = rememberUpdatedState(onCameraError)
    val currentEmbeddingCallback = rememberUpdatedState(onEmbeddingReady)
    val analyzer = remember(embeddingModel, livenessModel) {
        FaceAnalyzer(
            embeddingModel = embeddingModel,
            alignment = ArcFaceAligner(),
            inferenceExecutor = analysisExecutor,
            onStateChanged = { currentStateCallback.value(it) },
            onEmbeddingReady = { embedding, version ->
                currentEmbeddingCallback.value(embedding, version)
            },
            livenessModel = livenessModel,
        )
    }

    DisposableEffect(lifecycleOwner, embeddingModel, livenessModel) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        val mainExecutor = ContextCompat.getMainExecutor(context)
        val listener = Runnable {
            try {
                bindCamera(
                    lifecycleOwner = lifecycleOwner,
                    previewView = previewView,
                    analysisExecutor = analysisExecutor,
                    analyzer = analyzer,
                    cameraProvider = cameraProviderFuture.get(),
                )
            } catch (error: Exception) {
                Log.e(TAG, "Unable to bind camera", error)
                currentCameraErrorCallback.value("Camera unavailable")
            }
        }
        cameraProviderFuture.addListener(listener, mainExecutor)

        onDispose {
            runCatching { cameraProviderFuture.get().unbindAll() }
            analyzer.close()
            analysisExecutor.shutdown()
        }
    }

    AndroidView(
        factory = { previewView },
        modifier = modifier,
    )
}

private fun bindCamera(
    lifecycleOwner: androidx.lifecycle.LifecycleOwner,
    previewView: PreviewView,
    analysisExecutor: ExecutorService,
    analyzer: FaceAnalyzer,
    cameraProvider: ProcessCameraProvider,
) {
    val preview = Preview.Builder().build().also {
        it.surfaceProvider = previewView.surfaceProvider
    }
    val imageAnalysis = ImageAnalysis.Builder()
        .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
        .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_YUV_420_888)
        .build()
        .also { it.setAnalyzer(analysisExecutor, analyzer) }

    cameraProvider.unbindAll()
    cameraProvider.bindToLifecycle(
        lifecycleOwner,
        CameraSelector.DEFAULT_FRONT_CAMERA,
        preview,
        imageAnalysis,
    )
}

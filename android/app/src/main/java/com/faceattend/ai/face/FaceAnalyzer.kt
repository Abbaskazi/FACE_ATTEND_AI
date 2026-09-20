package com.faceattend.ai.face

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.media.Image
import android.util.Log
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import com.faceattend.ai.BuildConfig
import com.faceattend.ai.camera.ImageProxyBitmapConverter
import com.faceattend.ai.domain.FaceCountGate
import com.faceattend.ai.domain.FaceGateStatus
import com.faceattend.ai.face.alignment.BitmapOrientation
import com.faceattend.ai.face.alignment.FaceAlignment
import com.faceattend.ai.face.embedding.BitmapRgbConverter
import com.faceattend.ai.face.embedding.FaceEmbedding
import com.faceattend.ai.face.embedding.FaceEmbeddingModel
import com.faceattend.ai.face.liveness.FaceLivenessCropper
import com.faceattend.ai.face.liveness.FaceLivenessModel
import com.faceattend.ai.face.liveness.LivenessAggregator
import com.faceattend.ai.face.liveness.LivenessDecision
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.util.concurrent.Executor

private const val TAG = "FaceAttendFace"
private const val LIVENESS_RETRY_DELAY_MILLIS = 1_500L

class FaceAnalyzer(
    private val embeddingModel: FaceEmbeddingModel,
    private val alignment: FaceAlignment,
    private val inferenceExecutor: Executor,
    private val onStateChanged: (FaceDetectionState) -> Unit,
    private val onEmbeddingReady: (FaceEmbedding, String) -> Unit = { _, _ -> },
    private val livenessModel: FaceLivenessModel? = null,
) : ImageAnalysis.Analyzer {
    private val detector: FaceDetector = FaceDetection.getClient(
        FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setContourMode(FaceDetectorOptions.CONTOUR_MODE_NONE)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_NONE)
            .enableTracking()
            .setMinFaceSize(0.15f)
            .build(),
    )
    private val livenessAggregator = LivenessAggregator()
    private var activeTrackingId: Int? = null
    private var livenessPassed = false
    private var embeddingEmitted = false
    private var livenessRetryAtMillis = 0L

    @SuppressLint("UnsafeOptInUsageError")
    override fun analyze(imageProxy: ImageProxy) {
        val mediaImage: Image = imageProxy.image ?: run {
            imageProxy.close()
            return
        }

        val rotationDegrees = imageProxy.imageInfo.rotationDegrees
        val sourceBitmap = runCatching { ImageProxyBitmapConverter.toBitmap(imageProxy) }
            .getOrElse { error ->
                Log.w(TAG, "Camera frame conversion failed", error)
                imageProxy.close()
                onStateChanged(FaceDetectionState(errorMessage = "Camera frame unavailable"))
                return
            }
        val orientedBitmap = runCatching {
            BitmapOrientation.rotate(sourceBitmap, rotationDegrees)
        }.getOrElse { error ->
            Log.w(TAG, "Camera frame rotation failed", error)
            sourceBitmap.recycle()
            imageProxy.close()
            onStateChanged(FaceDetectionState(errorMessage = "Camera frame unavailable"))
            return
        }
        val image = InputImage.fromBitmap(orientedBitmap, 0)

        detector.process(image)
            .addOnSuccessListener(inferenceExecutor) { faces ->
                val gateStatus = FaceCountGate.statusFor(faces.size)
                if (gateStatus != FaceGateStatus.SINGLE_FACE) {
                    resetLivenessSession("face-count-${faces.size}")
                    onStateChanged(FaceDetectionState(status = gateStatus))
                    return@addOnSuccessListener
                }

                val face = faces.single()
                val state = runCatching {
                    if (livenessModel != null) {
                        analyzeLiveness(orientedBitmap, face, gateStatus)
                    } else {
                        embedFace(orientedBitmap, face, gateStatus)
                    }
                }.getOrElse { error ->
                    Log.w(TAG, "Face verification failed", error)
                    FaceDetectionState(
                        status = gateStatus,
                        trackingId = face.trackingId,
                        livenessStatus = if (livenessModel == null) {
                            LivenessStatus.IDLE
                        } else {
                            LivenessStatus.FAILED
                        },
                        errorMessage = if (livenessModel == null) {
                            "Face embedding unavailable"
                        } else {
                            "Face liveness unavailable"
                        },
                    )
                }
                onStateChanged(state)
            }
            .addOnFailureListener(inferenceExecutor) { error ->
                Log.w(TAG, "Face detection failed", error)
                resetLivenessSession("detector-failure")
                onStateChanged(FaceDetectionState(errorMessage = "Face detection unavailable"))
            }
            .addOnCompleteListener(inferenceExecutor) {
                if (orientedBitmap !== sourceBitmap) orientedBitmap.recycle()
                sourceBitmap.recycle()
                imageProxy.close()
            }
    }

    private fun analyzeLiveness(
        frame: Bitmap,
        face: Face,
        gateStatus: FaceGateStatus,
    ): FaceDetectionState {
        val trackingId = face.trackingId ?: run {
            resetLivenessSession("missing-tracking-id")
            return FaceDetectionState(
                status = gateStatus,
                livenessStatus = LivenessStatus.IDLE,
                errorMessage = "Face tracking unavailable",
            )
        }

        if (activeTrackingId != null && activeTrackingId != trackingId) {
            resetLivenessSession("tracking-changed-${activeTrackingId}-$trackingId")
        }
        if (activeTrackingId == null) activeTrackingId = trackingId

        val now = System.currentTimeMillis()
        if (now < livenessRetryAtMillis) {
            return FaceDetectionState(
                status = gateStatus,
                livenessStatus = LivenessStatus.FAILED,
                trackingId = trackingId,
                errorMessage = "Face verification failed. Please use a live face.",
            )
        }
        if (livenessRetryAtMillis != 0L) {
            livenessRetryAtMillis = 0L
            livenessAggregator.reset()
        }

        if (!livenessPassed) {
            val crop = FaceLivenessCropper.crop(frame, face.boundingBox)
            val frameNumber = livenessAggregator.frameCount + 1
            val prediction = livenessModel!!.predict(crop)
            val aggregation = livenessAggregator.add(prediction.liveScore)
            if (BuildConfig.DEBUG) {
                val bytes = crop.bgr.map { it.toInt() and 0xFF }
                val normalizedMin = (bytes.minOrNull() ?: 0) / 255f
                val normalizedMax = (bytes.maxOrNull() ?: 0) / 255f
                Log.d(
                    "FaceAttendLiveness",
                    "frame=$frameNumber validFrames=${aggregation.frameCount}/" +
                        "${LivenessAggregator.REQUIRED_LIVENESS_FRAMES} " +
                        "trackingId=$trackingId cameraFrame=${frame.width}x${frame.height} " +
                        "bbox=${face.boundingBox} crop=${crop.width}x${crop.height} " +
                        "channels=BGR normalized=/255 range=$normalizedMin..$normalizedMax " +
                        "logits=${prediction.logits.joinToString(prefix = "[", postfix = "]") { "%.5f".format(it) }} " +
                        "liveScore=${"%.5f".format(prediction.liveScore)} " +
                        "liveFrames=${aggregation.liveFrameCount} median=${"%.5f".format(aggregation.medianScore)} " +
                        "decision=${aggregation.decision}",
                )
            }
            if (aggregation.decision == LivenessDecision.SPOOF) {
                resetLivenessSession("spoof-window")
                livenessRetryAtMillis = now + LIVENESS_RETRY_DELAY_MILLIS
                return FaceDetectionState(
                    status = gateStatus,
                    livenessStatus = LivenessStatus.FAILED,
                    livenessProgress = 100,
                    livenessScore = aggregation.medianScore,
                    trackingId = trackingId,
                    errorMessage = "Face verification failed. Please use a live face.",
                )
            }
            if (aggregation.decision == LivenessDecision.LIVE) {
                livenessPassed = true
                return embedFace(
                    frame,
                    face,
                    gateStatus,
                    LivenessStatus.PASSED,
                    aggregation.progressPercent,
                    aggregation.medianScore,
                    trackingId,
                )
            }
            return FaceDetectionState(
                status = gateStatus,
                livenessStatus = LivenessStatus.COLLECTING,
                livenessProgress = aggregation.progressPercent,
                livenessScore = aggregation.medianScore,
                trackingId = trackingId,
            )
        }

        return embedFace(
            frame,
            face,
            gateStatus,
            LivenessStatus.PASSED,
            100,
            null,
            trackingId,
        )
    }

    private fun embedFace(
        frame: Bitmap,
        face: Face,
        gateStatus: FaceGateStatus,
        livenessStatus: LivenessStatus = LivenessStatus.IDLE,
        livenessProgress: Int = 0,
        livenessScore: Float? = null,
        trackingId: Int? = face.trackingId,
    ): FaceDetectionState {
        if (!embeddingEmitted) {
            val alignedFace = alignment.align(frame, face, rotationDegrees = 0)
            try {
                val rgbFace = BitmapRgbConverter.toRgbImage(alignedFace.bitmap)
                val embedding = embeddingModel.embed(rgbFace)
                onEmbeddingReady(embedding, alignedFace.alignmentVersion)
                embeddingEmitted = true
            } finally {
                alignedFace.bitmap.recycle()
            }
        }
        return FaceDetectionState(
            status = gateStatus,
            embeddingReady = embeddingEmitted,
            alignmentVersion = alignment.version,
            livenessStatus = livenessStatus,
            livenessProgress = livenessProgress,
            livenessScore = livenessScore,
            trackingId = trackingId,
        )
    }

    private fun resetLivenessSession(reason: String = "unspecified") {
        if (BuildConfig.DEBUG && (activeTrackingId != null || livenessAggregator.frameCount > 0)) {
            Log.d(
                "FaceAttendLiveness",
                "reset reason=$reason trackingId=$activeTrackingId validFrames=" +
                    "${livenessAggregator.frameCount}/${LivenessAggregator.REQUIRED_LIVENESS_FRAMES}",
            )
        }
        activeTrackingId = null
        livenessPassed = false
        embeddingEmitted = false
        livenessRetryAtMillis = 0L
        livenessAggregator.reset()
    }

    fun close() {
        detector.close()
    }
}

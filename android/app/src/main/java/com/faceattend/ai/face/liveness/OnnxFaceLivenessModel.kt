package com.faceattend.ai.face.liveness

import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtProvider
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.content.Context
import android.util.Log
import com.faceattend.ai.face.embedding.ModelHashVerifier
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "FaceAttendLiveness"

class OnnxFaceLivenessModel(
    context: Context,
    private val assetName: String = LIVENESS_MODEL_ASSET_NAME,
) : FaceLivenessModel {
    private val environment = OrtEnvironment.getEnvironment()
    private val inputName: String
    private val outputName: String
    private val session: OrtSession
    private val closed = AtomicBoolean(false)

    init {
        val modelBytes = context.assets.open(assetName).use { input ->
            val actualSha = ModelHashVerifier.sha256Hex(input)
            require(actualSha.equals(VERIFIED_LIVENESS_MODEL_SHA256, ignoreCase = true)) {
                "Liveness model SHA-256 mismatch; refusing to initialize"
            }
            context.assets.open(assetName).use { it.readBytes() }
        }

        val options = OrtSession.SessionOptions()
        try {
            require(OrtProvider.XNNPACK in OrtEnvironment.getAvailableProviders()) {
                "ONNX Runtime XNNPACK provider is unavailable; refusing CPU-only fallback"
            }
            try {
                options.addXnnpack(emptyMap())
            } catch (error: OrtException) {
                throw IllegalStateException(
                    "ONNX Runtime XNNPACK initialization failed; refusing CPU-only fallback",
                    error,
                )
            }
            Log.i(TAG, "ONNX Runtime XNNPACK initialized")
            session = environment.createSession(modelBytes, options)
        } finally {
            options.close()
        }

        try {
            require(session.inputNames.size == 1) { "Expected one liveness model input" }
            require(session.outputNames.size == 1) { "Expected one liveness model output" }
            inputName = session.inputNames.single()
            outputName = session.outputNames.single()
            validateGraphContract()
        } catch (error: Throwable) {
            session.close()
            throw error
        }
    }

    override fun predict(face: BgrImage): LivenessPrediction {
        val input = LivenessPreprocessor.toNchwFloat32(face)
        val tensor = OnnxTensor.createTensor(
            environment,
            FloatBuffer.wrap(input),
            longArrayOf(1, 3, LIVENESS_MODEL_INPUT_SIZE.toLong(), LIVENESS_MODEL_INPUT_SIZE.toLong()),
        )
        tensor.use { inputTensor ->
            session.run(mapOf(inputName to inputTensor)).use { result ->
                val outputValue = result.get(outputName).orElse(null)
                    ?: throw IllegalStateException("Liveness model returned no output")
                val outputTensor = outputValue as? OnnxTensor
                    ?: throw IllegalStateException("Liveness model output is not a tensor")
                val outputInfo = outputTensor.info as? TensorInfo
                    ?: throw IllegalStateException("Liveness model output metadata is unavailable")
                require(outputInfo.type == OnnxJavaType.FLOAT) {
                    "Liveness model output must be float32"
                }
                require(outputInfo.shape.contentEquals(longArrayOf(1, LIVENESS_MODEL_OUTPUT_CLASSES.toLong()))) {
                    "Liveness model output must be [1, $LIVENESS_MODEL_OUTPUT_CLASSES]"
                }
                val outputBuffer = outputTensor.floatBuffer
                    ?: throw IllegalStateException("Liveness model output cannot be read as float32")
                val logits = FloatArray(LIVENESS_MODEL_OUTPUT_CLASSES)
                outputBuffer.get(logits)
                return LivenessPrediction(
                    logits = logits.copyOf(),
                    liveScore = softmax(logits)[LIVENESS_LIVE_CLASS_INDEX],
                )
            }
        }
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) session.close()
    }

    private fun validateGraphContract() {
        val inputInfo = session.inputInfo[inputName]?.info as? TensorInfo
            ?: throw IllegalStateException("Liveness model input metadata is unavailable")
        require(inputInfo.type == OnnxJavaType.FLOAT) { "Liveness model input must be float32" }
        val inputShape = inputInfo.shape
        require(inputShape.size == 4) { "Liveness model input must be rank 4 NCHW" }
        require(inputShape[0] == 1L || inputShape[0] < 0L) { "Liveness model batch is unsupported" }
        require(
            inputShape.drop(1).toLongArray().contentEquals(
                longArrayOf(3, LIVENESS_MODEL_INPUT_SIZE.toLong(), LIVENESS_MODEL_INPUT_SIZE.toLong()),
            ),
        ) { "Liveness model input must be [N, 3, 80, 80]" }

        val outputInfo = session.outputInfo[outputName]?.info as? TensorInfo
            ?: throw IllegalStateException("Liveness model output metadata is unavailable")
        require(outputInfo.type == OnnxJavaType.FLOAT) { "Liveness model output must be float32" }
        require(
            outputInfo.shape.size == 2 &&
                (outputInfo.shape[0] == 1L || outputInfo.shape[0] < 0L) &&
                outputInfo.shape[1] == LIVENESS_MODEL_OUTPUT_CLASSES.toLong(),
        ) { "Liveness model output must be [N, 3]" }
        Log.i(
            TAG,
            "MiniFASNet graph verified input=${inputInfo.shape.contentToString()} " +
                "output=${outputInfo.shape.contentToString()} provider=XNNPACK " +
                "liveClass=$LIVENESS_LIVE_CLASS_INDEX",
        )
    }

    private fun softmax(logits: FloatArray): FloatArray {
        val max = logits.maxOrNull() ?: error("Liveness model returned no logits")
        val exponentials = FloatArray(logits.size) { index -> kotlin.math.exp((logits[index] - max).toDouble()).toFloat() }
        val total = exponentials.sum()
        require(total > 0f && total.isFinite()) { "Liveness model returned invalid logits" }
        return FloatArray(exponentials.size) { index -> exponentials[index] / total }
    }
}

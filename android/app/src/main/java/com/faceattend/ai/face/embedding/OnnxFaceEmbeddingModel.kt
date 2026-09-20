package com.faceattend.ai.face.embedding

import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtException
import ai.onnxruntime.OrtProvider
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import android.content.Context
import android.util.Log
import java.nio.FloatBuffer
import java.util.concurrent.atomic.AtomicBoolean

private const val TAG = "FaceAttendModel"

class OnnxFaceEmbeddingModel(
    context: Context,
    private val assetName: String = MODEL_ASSET_NAME,
) : FaceEmbeddingModel {
    private val environment = OrtEnvironment.getEnvironment()
    private val inputName: String
    private val outputName: String
    private val session: OrtSession
    private val closed = AtomicBoolean(false)

    init {
        val modelBytes = context.assets.open(assetName).use { input ->
            val actualSha = ModelHashVerifier.sha256Hex(input)
            ModelHashVerifier.requireSha256(actualSha)
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
            require(session.inputNames.size == 1) { "Expected one model input" }
            require(session.outputNames.size == 1) { "Expected one model output" }
            inputName = session.inputNames.single()
            outputName = session.outputNames.single()
            validateGraphContract()
        } catch (error: Throwable) {
            session.close()
            throw error
        }
    }

    override fun embed(face: RgbImage): FaceEmbedding {
        val input = EmbeddingPreprocessor.toNchwFloat32(face)
        val tensor = OnnxTensor.createTensor(
            environment,
            FloatBuffer.wrap(input),
            longArrayOf(1, 3, MODEL_INPUT_HEIGHT.toLong(), MODEL_INPUT_WIDTH.toLong()),
        )

        tensor.use { inputTensor ->
            session.run(mapOf(inputName to inputTensor)).use { result ->
                val outputValue = result.get(outputName).orElse(null)
                    ?: throw IllegalStateException("Model did not return the expected output")
                val outputTensor = outputValue as? OnnxTensor
                    ?: throw IllegalStateException("Model output is not a tensor")
                val outputInfo = outputTensor.info as? TensorInfo
                    ?: throw IllegalStateException("Model output metadata is unavailable")
                require(outputInfo.type == OnnxJavaType.FLOAT) {
                    "Model output must be float32"
                }
                require(outputInfo.shape.contentEquals(longArrayOf(1, EMBEDDING_DIMENSION.toLong()))) {
                    "Model output shape must be [1, $EMBEDDING_DIMENSION]"
                }
                val outputBuffer = outputTensor.floatBuffer
                    ?: throw IllegalStateException("Model output cannot be read as float32")
                val raw = FloatArray(EMBEDDING_DIMENSION)
                outputBuffer.get(raw)
                EmbeddingValidator.validateRaw(raw)
                return FaceEmbedding(EmbeddingNormalizer.l2Normalize(raw))
            }
        }
    }

    private fun validateGraphContract() {
        val inputInfo = session.inputInfo[inputName]?.info as? TensorInfo
            ?: throw IllegalStateException("Model input metadata is unavailable")
        require(inputInfo.type == OnnxJavaType.FLOAT) { "Model input must be float32" }
        val inputShape = inputInfo.shape
        require(inputShape.size == 4) { "Model input must be rank 4 NCHW" }
        require(inputShape[0] == 1L || inputShape[0] < 0L) { "Model batch dimension is unsupported" }
        require(inputShape.drop(1).toLongArray().contentEquals(longArrayOf(3, 112, 112))) {
            "Model input must be [N, 3, 112, 112]"
        }

        val outputInfo = session.outputInfo[outputName]?.info as? TensorInfo
            ?: throw IllegalStateException("Model output metadata is unavailable")
        require(outputInfo.type == OnnxJavaType.FLOAT) { "Model output must be float32" }
        require(outputInfo.shape.size == 2 && outputInfo.shape[1] == EMBEDDING_DIMENSION.toLong()) {
            "Model output must be [1, $EMBEDDING_DIMENSION]"
        }
    }

    override fun close() {
        if (closed.compareAndSet(false, true)) {
            session.close()
        }
    }
}

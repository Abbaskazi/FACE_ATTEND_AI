package com.faceattend.ai.face.embedding

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/** Hashes the NCHW Float32 tensor values in Android/ONNX little-endian order. */
object EmbeddingTensorHasher {
    fun sha256(values: FloatArray): String {
        require(values.size == 3 * MODEL_INPUT_WIDTH * MODEL_INPUT_HEIGHT) {
            "Input tensor must contain exactly [1,3,112,112] Float32 values"
        }
        val bytes = ByteBuffer
            .allocate(values.size * Float.SIZE_BYTES)
            .order(ByteOrder.LITTLE_ENDIAN)
        values.forEach { value -> bytes.putInt(value.toRawBits()) }
        return MessageDigest.getInstance("SHA-256").digest(bytes.array())
            .joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
}

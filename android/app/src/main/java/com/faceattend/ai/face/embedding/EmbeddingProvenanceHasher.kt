package com.faceattend.ai.face.embedding

import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.security.MessageDigest

/**
 * Temporary enrollment diagnostic hash for a normalized Float32 embedding.
 *
 * The hash input is exactly 512 IEEE-754 Float32 raw bit patterns, emitted in
 * embedding order as four-byte big-endian integers. It is deliberately not a
 * hash of JSON text, so formatting and number rendering cannot change it.
 */
object EmbeddingProvenanceHasher {
    fun sha256(values: FloatArray): String {
        require(values.size == EMBEDDING_DIMENSION) {
            "Embedding must contain exactly $EMBEDDING_DIMENSION values"
        }

        val bytes = ByteBuffer
            .allocate(values.size * Float.SIZE_BYTES)
            .order(ByteOrder.BIG_ENDIAN)
        values.forEach { value -> bytes.putInt(value.toRawBits()) }

        val digest = MessageDigest.getInstance("SHA-256").digest(bytes.array())
        return digest.joinToString(separator = "") { byte -> "%02x".format(byte) }
    }
}

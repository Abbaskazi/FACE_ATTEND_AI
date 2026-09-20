package com.faceattend.ai.face.embedding

import java.io.InputStream
import java.security.MessageDigest

object ModelHashVerifier {
    fun sha256Hex(input: InputStream): String {
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            digest.update(buffer, 0, count)
        }
        return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
    }

    fun requireSha256(actual: String, expected: String = VERIFIED_MODEL_SHA256) {
        require(actual.equals(expected, ignoreCase = true)) {
            "Model SHA-256 mismatch; refusing to initialize the face model"
        }
    }
}

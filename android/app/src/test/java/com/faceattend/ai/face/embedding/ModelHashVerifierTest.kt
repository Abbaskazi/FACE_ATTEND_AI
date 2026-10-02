package com.faceattend.ai.face.embedding

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
import org.junit.Test

class ModelHashVerifierTest {
    @Test
    fun calculatesSha256Deterministically() {
        val hash = ModelHashVerifier.sha256Hex(ByteArrayInputStream("FaceAttend".toByteArray()))
        assertEquals(
            "63072dbdcdafb04e458aa8701efd50d87307de7437b2913b08299e5514e28753",
            hash,
        )
    }

    @Test
    fun acceptsExpectedHashCaseInsensitively() {
        ModelHashVerifier.requireSha256("ABC", "abc")
    }

    @Test
    fun copiesAndHashesAsAStream() {
        val source = "FaceAttend streamed model bytes".repeat(4096).toByteArray()
        val output = ByteArrayOutputStream()

        val hash = ModelHashVerifier.copySha256(ByteArrayInputStream(source), output)

        assertEquals(
            ModelHashVerifier.sha256Hex(ByteArrayInputStream(source)),
            hash,
        )
        assertEquals(source.toList(), output.toByteArray().toList())
    }

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnexpectedHash() {
        ModelHashVerifier.requireSha256("wrong", "expected")
    }
}

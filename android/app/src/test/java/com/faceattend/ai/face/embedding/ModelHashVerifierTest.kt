package com.faceattend.ai.face.embedding

import java.io.ByteArrayInputStream
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

    @Test(expected = IllegalArgumentException::class)
    fun rejectsUnexpectedHash() {
        ModelHashVerifier.requireSha256("wrong", "expected")
    }
}

package com.faceattend.ai.enrollment

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class EnrollmentCaptureGuardTest {
    @Test
    fun onlyCurrentGenerationCanSubmit() {
        assertTrue(EnrollmentCaptureGuard.isCurrent("generation-a", "generation-a"))
        assertFalse(EnrollmentCaptureGuard.isCurrent("generation-a", "generation-b"))
        assertFalse(EnrollmentCaptureGuard.isCurrent(null, "generation-a"))
        assertFalse(EnrollmentCaptureGuard.isCurrent("", "generation-a"))
    }
}

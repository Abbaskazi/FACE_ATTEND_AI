package com.faceattend.ai.auth

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceSessionTest {
    @Test
    fun sessionRetainsAccessAndRefreshTokens() {
        val session = DeviceSession("access", "refresh", 2_000L)

        assertEquals("access", session.accessToken)
        assertEquals("refresh", session.refreshToken)
        assertEquals(2_000L, session.expiresAtEpochSeconds)
    }

    @Test
    fun expiredSessionIsNotUsable() {
        val session = DeviceSession("access", "refresh", 1_000L)

        assertFalse(session.isUsable(nowEpochSeconds = 1_000L))
        assertTrue(session.isUsable(nowEpochSeconds = 900L))
    }
}

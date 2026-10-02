package com.faceattend.ai.face.alignment

import android.graphics.Bitmap
import android.graphics.Matrix

/** Produces the upright image coordinate system used by ML Kit and alignment. */
object BitmapOrientation {
    fun rotate(bitmap: Bitmap, rotationDegrees: Int): Bitmap {
        val normalized = normalizeDegrees(rotationDegrees)
        require(normalized in setOf(0, 90, 180, 270)) {
            "Camera rotation must be 0, 90, 180, or 270 degrees"
        }
        if (normalized == 0) return bitmap
        return Bitmap.createBitmap(
            bitmap,
            0,
            0,
            bitmap.width,
            bitmap.height,
            Matrix().apply { postRotate(normalized.toFloat()) },
            true,
        )
    }

    fun normalizeDegrees(rotationDegrees: Int): Int = ((rotationDegrees % 360) + 360) % 360
}

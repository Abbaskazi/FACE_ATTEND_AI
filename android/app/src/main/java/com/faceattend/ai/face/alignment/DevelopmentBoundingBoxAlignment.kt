package com.faceattend.ai.face.alignment

import android.graphics.Bitmap
import android.graphics.Matrix
import com.google.mlkit.vision.face.Face
import kotlin.math.max
import kotlin.math.min

/**
 * Development-only crop. This is not the production ArcFace five-point alignment.
 * ML Kit landmarks are detected in this batch, but their coordinate convention is
 * not used here until a separately verified alignment implementation is added.
 */
class DevelopmentBoundingBoxAlignment : FaceAlignment {
    override val version: String = "development-bounding-box-v1"

    override fun align(frame: Bitmap, face: Face, rotationDegrees: Int): AlignedFace {
        val oriented = rotate(frame, rotationDegrees)
        val box = face.boundingBox
        val left = max(0, min(box.left, oriented.width - 1))
        val top = max(0, min(box.top, oriented.height - 1))
        val right = max(left + 1, min(box.right, oriented.width))
        val bottom = max(top + 1, min(box.bottom, oriented.height))
        val crop = Bitmap.createBitmap(oriented, left, top, right - left, bottom - top)
        val resized = Bitmap.createScaledBitmap(crop, 112, 112, true)
        if (crop !== resized) crop.recycle()
        if (oriented !== frame) oriented.recycle()
        return AlignedFace(resized, version)
    }

    private fun rotate(bitmap: Bitmap, degrees: Int): Bitmap {
        if (degrees == 0) return bitmap
        val matrix = Matrix().apply { postRotate(degrees.toFloat()) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }
}

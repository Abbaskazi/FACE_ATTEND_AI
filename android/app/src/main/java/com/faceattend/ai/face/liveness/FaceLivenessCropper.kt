package com.faceattend.ai.face.liveness

import android.graphics.Bitmap
import android.graphics.Rect

/** Implements the upstream 2.7x face-box crop used by 2.7_80x80_MiniFASNetV2. */
object FaceLivenessCropper {
    private const val FACE_SCALE = 2.7f

    fun crop(frame: Bitmap, boundingBox: Rect): BgrImage {
        val left = boundingBox.left.coerceIn(0, frame.width - 1)
        val top = boundingBox.top.coerceIn(0, frame.height - 1)
        val right = boundingBox.right.coerceIn(left + 1, frame.width)
        val bottom = boundingBox.bottom.coerceIn(top + 1, frame.height)
        val boxWidth = (right - left).toFloat()
        val boxHeight = (bottom - top).toFloat()
        val scale = minOf(
            (frame.height - 1).toFloat() / boxHeight,
            minOf((frame.width - 1).toFloat() / boxWidth, FACE_SCALE),
        )
        val centerX = left + boxWidth / 2f
        val centerY = top + boxHeight / 2f
        val cropWidth = (boxWidth * scale).coerceAtLeast(1f)
        val cropHeight = (boxHeight * scale).coerceAtLeast(1f)

        var cropLeft = centerX - cropWidth / 2f
        var cropTop = centerY - cropHeight / 2f
        var cropRight = centerX + cropWidth / 2f
        var cropBottom = centerY + cropHeight / 2f
        if (cropLeft < 0f) {
            cropRight -= cropLeft
            cropLeft = 0f
        }
        if (cropTop < 0f) {
            cropBottom -= cropTop
            cropTop = 0f
        }
        if (cropRight > frame.width - 1) {
            cropLeft -= cropRight - (frame.width - 1)
            cropRight = (frame.width - 1).toFloat()
        }
        if (cropBottom > frame.height - 1) {
            cropTop -= cropBottom - (frame.height - 1)
            cropBottom = (frame.height - 1).toFloat()
        }

        val source = Bitmap.createBitmap(
            frame,
            cropLeft.coerceIn(0f, (frame.width - 1).toFloat()).toInt(),
            cropTop.coerceIn(0f, (frame.height - 1).toFloat()).toInt(),
            (cropRight - cropLeft).coerceAtLeast(1f).toInt().coerceAtMost(frame.width),
            (cropBottom - cropTop).coerceAtLeast(1f).toInt().coerceAtMost(frame.height),
        )
        val resized = Bitmap.createScaledBitmap(
            source,
            LIVENESS_MODEL_INPUT_SIZE,
            LIVENESS_MODEL_INPUT_SIZE,
            true,
        )
        if (resized !== source) source.recycle()

        val argb = IntArray(LIVENESS_MODEL_INPUT_SIZE * LIVENESS_MODEL_INPUT_SIZE)
        resized.getPixels(
            argb,
            0,
            LIVENESS_MODEL_INPUT_SIZE,
            0,
            0,
            LIVENESS_MODEL_INPUT_SIZE,
            LIVENESS_MODEL_INPUT_SIZE,
        )
        resized.recycle()
        val bgr = argbToBgr(argb)
        return BgrImage(LIVENESS_MODEL_INPUT_SIZE, LIVENESS_MODEL_INPUT_SIZE, bgr)
    }

    internal fun argbToBgr(argb: IntArray): ByteArray {
        val bgr = ByteArray(argb.size * 3)
        argb.forEachIndexed { index, pixel ->
            val offset = index * 3
            bgr[offset] = (pixel and 0xFF).toByte()
            bgr[offset + 1] = ((pixel shr 8) and 0xFF).toByte()
            bgr[offset + 2] = ((pixel shr 16) and 0xFF).toByte()
        }
        return bgr
    }
}

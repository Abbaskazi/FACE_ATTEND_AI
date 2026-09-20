package com.faceattend.ai.face.embedding

import android.graphics.Bitmap

object BitmapRgbConverter {
    fun toRgbImage(bitmap: Bitmap): RgbImage {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val rgb = ByteArray(pixels.size * 3)
        pixels.forEachIndexed { index, pixel ->
            val offset = index * 3
            rgb[offset] = ((pixel shr 16) and 0xFF).toByte()
            rgb[offset + 1] = ((pixel shr 8) and 0xFF).toByte()
            rgb[offset + 2] = (pixel and 0xFF).toByte()
        }
        return RgbImage(bitmap.width, bitmap.height, rgb)
    }
}

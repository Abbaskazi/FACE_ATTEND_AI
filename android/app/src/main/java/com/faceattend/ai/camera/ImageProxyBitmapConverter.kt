package com.faceattend.ai.camera

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageFormat
import android.graphics.Rect
import android.graphics.YuvImage
import android.annotation.SuppressLint
import androidx.camera.core.ImageProxy
import java.io.ByteArrayOutputStream

/**
 * Converts a raw, unrotated ML Kit YUV_420_888 analysis frame to RGB.
 * Rotation is applied by the analyzer before the same bitmap is passed to ML
 * Kit and the alignment component.
 */
object ImageProxyBitmapConverter {
    @SuppressLint("UnsafeOptInUsageError")
    fun toBitmap(imageProxy: ImageProxy): Bitmap {
        val image = imageProxy.image ?: error("Camera frame has no image")
        require(image.format == ImageFormat.YUV_420_888) { "Expected YUV_420_888 camera frames" }
        val width = image.width
        val height = image.height
        val nv21 = ByteArray(width * height * 3 / 2)
        copyLuma(imageProxy, nv21, width, height)
        copyChroma(imageProxy, nv21, width, height)

        val jpeg = ByteArrayOutputStream()
        check(
            YuvImage(nv21, ImageFormat.NV21, width, height, null)
                .compressToJpeg(Rect(0, 0, width, height), 90, jpeg),
        ) { "Unable to convert camera frame to RGB" }
        return BitmapFactory.decodeByteArray(jpeg.toByteArray(), 0, jpeg.size())
            ?: error("Unable to decode camera RGB frame")
    }

    private fun copyLuma(imageProxy: ImageProxy, output: ByteArray, width: Int, height: Int) {
        val plane = imageProxy.planes[0]
        val buffer = plane.buffer.duplicate()
        for (row in 0 until height) {
            for (column in 0 until width) {
                output[row * width + column] =
                    buffer.get(row * plane.rowStride + column * plane.pixelStride)
            }
        }
    }

    private fun copyChroma(imageProxy: ImageProxy, output: ByteArray, width: Int, height: Int) {
        val uPlane = imageProxy.planes[1]
        val vPlane = imageProxy.planes[2]
        val uBuffer = uPlane.buffer.duplicate()
        val vBuffer = vPlane.buffer.duplicate()
        val chromaOffset = width * height
        val chromaWidth = width / 2
        val chromaHeight = height / 2
        for (row in 0 until chromaHeight) {
            for (column in 0 until chromaWidth) {
                val outputIndex = chromaOffset + row * width + column * 2
                output[outputIndex] = vBuffer.get(
                    row * vPlane.rowStride + column * vPlane.pixelStride,
                )
                output[outputIndex + 1] = uBuffer.get(
                    row * uPlane.rowStride + column * uPlane.pixelStride,
                )
            }
        }
    }
}

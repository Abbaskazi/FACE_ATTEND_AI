package com.faceattend.ai.diagnostics

import android.graphics.Bitmap
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.CRC32
import java.util.zip.Deflater

/** Lossless 8-bit RGB PNG encoder; it does not store an alpha channel. */
internal object RgbPngEncoder {
    private val signature = byteArrayOf(
        0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
    )

    fun encode(bitmap: Bitmap): ByteArray {
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val scanlines = ByteArray(bitmap.height * (1 + bitmap.width * 3))
        var offset = 0
        pixels.forEach { pixel ->
            if (offset % (1 + bitmap.width * 3) == 0) scanlines[offset++] = 0
            scanlines[offset++] = ((pixel shr 16) and 0xFF).toByte()
            scanlines[offset++] = ((pixel shr 8) and 0xFF).toByte()
            scanlines[offset++] = (pixel and 0xFF).toByte()
        }

        val compressed = ByteArrayOutputStream().use { output ->
            val deflater = Deflater(Deflater.DEFAULT_COMPRESSION, false)
            try {
                deflater.setInput(scanlines)
                deflater.finish()
                val buffer = ByteArray(8192)
                while (!deflater.finished()) output.write(buffer, 0, deflater.deflate(buffer))
            } finally {
                deflater.end()
            }
            output.toByteArray()
        }

        return ByteArrayOutputStream().use { output ->
            output.write(signature)
            output.writeChunk("IHDR", ByteBuffer.allocate(13).order(ByteOrder.BIG_ENDIAN).apply {
                putInt(bitmap.width)
                putInt(bitmap.height)
                put(8)
                put(2) // truecolor RGB
                put(0) // deflate
                put(0) // no filter
                put(0) // no interlace
            }.array())
            output.writeChunk("IDAT", compressed)
            output.writeChunk("IEND", ByteArray(0))
            output.toByteArray()
        }
    }

    private fun ByteArrayOutputStream.writeChunk(type: String, payload: ByteArray) {
        val typeBytes = type.toByteArray(Charsets.US_ASCII)
        write(ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(payload.size).array())
        write(typeBytes)
        write(payload)
        val crc = CRC32().apply {
            update(typeBytes)
            update(payload)
        }
        write(ByteBuffer.allocate(4).order(ByteOrder.BIG_ENDIAN).putInt(crc.value.toInt()).array())
    }
}

package com.faceattend.ai.face.embedding

import android.content.Context
import java.io.File
import java.io.FileOutputStream

/**
 * Materializes an ONNX asset as a verified internal file without holding the
 * model in a managed-memory byte array. ONNX Runtime can load this file by
 * path, allowing the native runtime to own its model-loading memory.
 */
internal object OnnxModelFileCache {
    private const val CACHE_DIRECTORY = "onnx-models"

    fun materialize(
        context: Context,
        assetName: String,
        expectedSha256: String,
    ): File {
        val directory = File(context.noBackupFilesDir, CACHE_DIRECTORY).apply {
            require(isDirectory || mkdirs()) { "Unable to create ONNX model cache directory" }
        }
        val cachedFile = File(directory, "$assetName.$expectedSha256.model")

        if (cachedFile.isFile) {
            verify(cachedFile, expectedSha256)
            return cachedFile
        }

        val temporaryFile = File.createTempFile("$assetName-", ".tmp", directory)
        try {
            val actualSha256 = context.assets.open(assetName).use { input ->
                FileOutputStream(temporaryFile).use { output ->
                    ModelHashVerifier.copySha256(input, output)
                }
            }
            ModelHashVerifier.requireSha256(actualSha256, expectedSha256)

            if (!temporaryFile.renameTo(cachedFile)) {
                require(cachedFile.isFile) { "Unable to finalize ONNX model cache file" }
                temporaryFile.delete()
            }
            verify(cachedFile, expectedSha256)
            return cachedFile
        } catch (error: Throwable) {
            temporaryFile.delete()
            throw error
        }
    }

    private fun verify(file: File, expectedSha256: String) {
        val actualSha256 = file.inputStream().use(ModelHashVerifier::sha256Hex)
        ModelHashVerifier.requireSha256(actualSha256, expectedSha256)
    }
}

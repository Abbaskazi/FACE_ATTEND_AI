package com.faceattend.ai.diagnostics

import android.content.Context
import androidx.core.content.FileProvider
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

enum class RecognitionLogExportFormat(val extension: String, val mimeType: String) {
    JSON("json", "application/json"),
    TEXT("txt", "text/plain"),
}

object RecognitionLogExport {
    fun write(context: Context, logs: List<RecognitionLog>, format: RecognitionLogExportFormat): File {
        val timestamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val file = File(context.cacheDir, "faceattend-recognition-logs-$timestamp.${format.extension}")
        file.writeText(
            when (format) {
                RecognitionLogExportFormat.JSON -> RecognitionLogCodec.encode(logs)
                RecognitionLogExportFormat.TEXT -> RecognitionLogFormatter.toText(logs)
            },
        )
        return file
    }

    fun uri(context: Context, file: File) = FileProvider.getUriForFile(
        context,
        "${context.packageName}.fileprovider",
        file,
    )
}

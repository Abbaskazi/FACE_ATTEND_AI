package com.faceattend.ai.diagnostics

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@Composable
@androidx.compose.material3.ExperimentalMaterial3Api
fun EnrollmentInputDiagnosticsScreen(
    repository: EnrollmentInputDiagnosticRepository,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    var records by remember { mutableStateOf(repository.all()) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    fun copyMetadata(record: EnrollmentInputDiagnosticRecord) {
        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Enrollment input diagnostic", repository.metadataJson(record)))
        statusMessage = "Metadata copied"
    }

    fun export(recordsToExport: List<EnrollmentInputDiagnosticRecord>) {
        runCatching {
            val file = repository.exportPackage(context, recordsToExport)
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
                type = "application/zip"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }, "Export enrollment diagnostics"))
            statusMessage = "Export prepared locally"
        }.onFailure { statusMessage = "Export failed" }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                title = { Text("Enrollment Input Diagnostics") },
                actions = {
                    TextButton(onClick = { export(records) }, enabled = records.isNotEmpty()) { Text("Export") }
                },
            )
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier.fillMaxSize().padding(paddingValues).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Debug-only local artifacts. The PNG is the exact 112x112 aligned RGB input; nothing is uploaded.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )
            statusMessage?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            if (records.isEmpty()) {
                Text("No enrollment input diagnostics captured yet.")
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    verticalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    items(records, key = { it.id }) { record ->
                        EnrollmentDiagnosticCard(
                            record = record,
                            repository = repository,
                            onCopy = { copyMetadata(record) },
                            onExport = { export(listOf(record)) },
                        )
                    }
                }
            }
            OutlinedButton(
                onClick = {
                    repository.clear()
                    records = emptyList()
                    statusMessage = "Diagnostics cleared"
                },
                enabled = records.isNotEmpty(),
            ) { Text("Clear diagnostics") }
        }
    }
}

@Composable
private fun EnrollmentDiagnosticCard(
    record: EnrollmentInputDiagnosticRecord,
    repository: EnrollmentInputDiagnosticRepository,
    onCopy: () -> Unit,
    onExport: () -> Unit,
) {
    val image = remember(record.id) { repository.image(record)?.asImageBitmap() }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                image?.let { Image(bitmap = it, contentDescription = "Aligned enrollment face", modifier = Modifier.size(112.dp)) }
                Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(record.employeeCode ?: "Employee code unavailable", style = MaterialTheme.typography.titleMedium)
                    Text(formatTimestamp(record.timestampEpochMs), style = MaterialTheme.typography.bodySmall)
                    Text("Input: ${record.alignedWidth}x${record.alignedHeight}  Rotation: ${record.rotationDegrees}°")
                    Text("Model: ${record.modelName}")
                    Text("Tensor: ${record.tensorShape.joinToString(prefix = "[", postfix = "]")}")
                    Text("${record.channelOrder}  ${record.preprocessingFormula}")
                }
            }
            Text("Face box: ${record.faceBoundingBox}")
            Text("Landmarks: ${record.sourceLandmarks}")
            Text("Embedding norm: ${"%.7f".format(Locale.US, record.embeddingL2Norm)}")
            Text("Image SHA: ${record.imageSha256}")
            Text("Tensor SHA: ${record.tensorSha256}")
            Text("Embedding provenance SHA: ${record.embeddingProvenanceSha256}")
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = onCopy) { Text("Copy metadata") }
                OutlinedButton(onClick = onExport) { Text("Export package") }
            }
        }
    }
}

private fun formatTimestamp(epochMs: Long): String = SimpleDateFormat(
    "yyyy-MM-dd HH:mm:ss.SSS z",
    Locale.US,
).format(Date(epochMs))

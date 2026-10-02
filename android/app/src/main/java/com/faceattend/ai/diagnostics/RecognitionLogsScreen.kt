package com.faceattend.ai.diagnostics

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

private enum class DateFilter(val label: String) {
    ALL("Any date"),
    TODAY("Today"),
    LAST_SEVEN_DAYS("Last 7 days"),
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun RecognitionLogsScreen(
    repository: RecognitionLogRepository,
    onBack: () -> Unit,
    onOpenEnrollmentDiagnostics: () -> Unit,
    onOpenLog: (String) -> Unit,
) {
    val context = LocalContext.current
    var allLogs by remember { mutableStateOf(repository.all()) }
    var search by remember { mutableStateOf("") }
    var operationFilter by remember { mutableStateOf<RecognitionOperation?>(null) }
    var resultFilter by remember { mutableStateOf<RecognitionLogResult?>(null) }
    var dateFilter by remember { mutableStateOf(DateFilter.ALL) }
    var exportMenuOpen by remember { mutableStateOf(false) }
    var statusMessage by remember { mutableStateOf<String?>(null) }

    val filteredLogs = allLogs.filter { log ->
        val query = search.trim().lowercase(Locale.US)
        val searchable = listOfNotNull(
            log.operation.name,
            log.result.name,
            log.employeeId,
            log.employeeCode,
            log.employeeName,
            log.topCandidate,
            log.errorCode,
            log.errorMessage,
        ).joinToString(" ").lowercase(Locale.US)
        val matchesSearch = query.isBlank() || searchable.contains(query)
        val matchesOperation = operationFilter == null || log.operation == operationFilter
        val matchesResult = resultFilter == null || log.result == resultFilter
        val matchesDate = dateFilter.includes(log.timestampEpochMs)
        matchesSearch && matchesOperation && matchesResult && matchesDate
    }

    fun copyText(label: String, text: String) {
        runCatching {
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
            statusMessage = "Copied to clipboard"
        }.onFailure { statusMessage = "Copy failed" }
    }

    fun shareExport(format: RecognitionLogExportFormat, logs: List<RecognitionLog>) {
        runCatching {
            val file = RecognitionLogExport.write(context, logs, format)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = format.mimeType
                putExtra(Intent.EXTRA_STREAM, RecognitionLogExport.uri(context, file))
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            context.startActivity(Intent.createChooser(intent, "Share recognition logs"))
            statusMessage = "Export prepared"
        }.onFailure { statusMessage = "Export failed" }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                title = { Text("Recognition Logs") },
                actions = {
                    TextButton(onClick = { exportMenuOpen = true }) { Text("Export") }
                    DropdownMenu(
                        expanded = exportMenuOpen,
                        onDismissRequest = { exportMenuOpen = false },
                    ) {
                        DropdownMenuItem(
                            text = { Text("Copy JSON") },
                            onClick = {
                                exportMenuOpen = false
                                copyText("FaceAttend recognition logs", repository.exportJson())
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Share JSON file") },
                            onClick = {
                                exportMenuOpen = false
                                shareExport(RecognitionLogExportFormat.JSON, allLogs)
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("Share TXT file") },
                            onClick = {
                                exportMenuOpen = false
                                shareExport(RecognitionLogExportFormat.TEXT, allLogs)
                            },
                        )
                    }
                },
            )
        },
    ) { paddingValues ->
        Column(
            modifier = Modifier.fillMaxSize().padding(paddingValues).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Text(
                "Local diagnostic logs only. Images, frames, embeddings, and vectors are never stored.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.secondary,
            )
            Text("Total logs: ${allLogs.size}", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = search,
                onValueChange = { search = it },
                label = { Text("Search logs") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                FilterButton(
                    label = operationFilter?.name ?: "All operations",
                    options = listOf(null) + RecognitionOperation.entries,
                    optionLabel = { it?.name ?: "All operations" },
                    onSelected = { operationFilter = it },
                )
                FilterButton(
                    label = resultFilter?.name ?: "All results",
                    options = listOf(null) + RecognitionLogResult.entries,
                    optionLabel = { it?.name ?: "All results" },
                    onSelected = { resultFilter = it },
                )
            }
            FilterButton(
                label = dateFilter.label,
                options = DateFilter.entries,
                optionLabel = { it.label },
                onSelected = { dateFilter = it },
            )
            statusMessage?.let { Text(it, color = MaterialTheme.colorScheme.primary) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (com.faceattend.ai.BuildConfig.DEBUG) {
                    OutlinedButton(onClick = onOpenEnrollmentDiagnostics) {
                        Text("Enrollment Input Diagnostics")
                    }
                }
                OutlinedButton(
                    onClick = {
                        allLogs = emptyList()
                        repository.clear()
                        statusMessage = "Logs cleared"
                    },
                    enabled = allLogs.isNotEmpty(),
                ) { Text("Clear all") }
                Button(
                    onClick = { copyText("FaceAttend recognition logs", RecognitionLogFormatter.toText(filteredLogs)) },
                    enabled = filteredLogs.isNotEmpty(),
                ) { Text("Copy filtered") }
            }
            HorizontalDivider()
            if (filteredLogs.isEmpty()) {
                Text("No local recognition logs match the current filters.")
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(filteredLogs, key = { it.id }) { log ->
                        RecognitionLogRow(log = log, onClick = { onOpenLog(log.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun <T> FilterButton(
    label: String,
    options: List<T>,
    optionLabel: (T) -> String,
    onSelected: (T) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        OutlinedButton(onClick = { expanded = true }) { Text(label) }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { option ->
                DropdownMenuItem(
                    text = { Text(optionLabel(option)) },
                    onClick = {
                        expanded = false
                        onSelected(option)
                    },
                )
            }
        }
    }
}

@Composable
private fun RecognitionLogRow(log: RecognitionLog, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
    ) {
        Column(modifier = Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(
                "${formatTimestamp(log.timestampEpochMs)}  •  ${log.operation.name}",
                style = MaterialTheme.typography.labelLarge,
            )
            Text(
                "${log.result.name}  •  ${log.employeeCode ?: log.topCandidate ?: "Employee unknown"}",
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                "Top: ${formatScore(log.topSimilarityScore)}  •  Margin: ${formatScore(log.recognitionMargin)}  •  " +
                    "${log.modelName ?: "Model unknown"}  •  ${log.processingDurationMs ?: "—"} ms",
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
fun RecognitionLogDetailScreen(log: RecognitionLog?, onBack: () -> Unit) {
    val context = LocalContext.current
    Scaffold(
        topBar = {
            TopAppBar(
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                title = { Text("Recognition Log Detail") },
            )
        },
    ) { paddingValues ->
        if (log == null) {
            Text("This local log is no longer available.", modifier = Modifier.padding(paddingValues).padding(16.dp))
            return@Scaffold
        }
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(paddingValues).padding(horizontal = 16.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            item {
                Text(
                    "Local diagnostic data only — no image or biometric vector is stored.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.secondary,
                    modifier = Modifier.padding(bottom = 8.dp),
                )
                Button(
                    onClick = {
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(
                            ClipData.newPlainText("FaceAttend recognition log", RecognitionLogFormatter.toText(log)),
                        )
                    },
                ) { Text("Copy this log") }
            }
            detailItems(log).forEach { (label, value) ->
                item { DetailField(label, value) }
            }
        }
    }
}

@Composable
private fun DetailField(label: String, value: String) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Text(value, style = MaterialTheme.typography.bodyMedium)
    }
}

private fun detailItems(log: RecognitionLog): List<Pair<String, String>> = listOf(
    "ID" to log.id,
    "Timestamp" to formatTimestamp(log.timestampEpochMs),
    "Operation" to log.operation.name,
    "Result" to log.result.name,
    "Employee ID" to (log.employeeId ?: "—"),
    "Employee code" to (log.employeeCode ?: "—"),
    "Employee name" to (log.employeeName ?: "—"),
    "Detected face count" to (log.detectedFaceCount?.toString() ?: "—"),
    "Candidate count" to (log.candidateCount?.toString() ?: "—"),
    "Selected face" to (log.selectedFace?.toString() ?: "—"),
    "Top candidate" to (log.topCandidate ?: "—"),
    "Top similarity score" to formatScore(log.topSimilarityScore),
    "Second-best similarity score" to formatScore(log.secondSimilarityScore),
    "Recognition margin" to formatScore(log.recognitionMargin),
    "Threshold" to formatScore(log.threshold),
    "Ambiguity margin" to formatScore(log.ambiguityMargin),
    "Model name" to (log.modelName ?: "—"),
    "Model version" to (log.modelVersion ?: "—"),
    "Model SHA-256" to (log.modelSha256 ?: "—"),
    "Embedding dimension" to (log.embeddingDimension?.toString() ?: "—"),
    "Embedding generated" to log.embeddingGenerated.toString(),
    "L2 normalization succeeded" to (log.l2NormalizationSucceeded?.toString() ?: "—"),
    "Camera status" to (log.cameraStatus ?: "—"),
    "Face detection status" to (log.faceDetectionStatus ?: "—"),
    "Error code" to (log.errorCode ?: "—"),
    "Error message" to (log.errorMessage ?: "—"),
    "App version" to (log.appVersion ?: "—"),
    "Device manufacturer" to (log.deviceManufacturer ?: "—"),
    "Device model" to (log.deviceModel ?: "—"),
    "Android version" to (log.androidVersion ?: "—"),
    "Android SDK" to (log.androidSdk?.toString() ?: "—"),
    "Processing duration (ms)" to (log.processingDurationMs?.toString() ?: "—"),
    "Diagnostic info" to (log.diagnosticInfo ?: "—"),
    "Provenance stage" to (log.provenanceStage ?: "—"),
    "Provenance SHA-256" to (log.provenanceEmbeddingSha256 ?: "—"),
    "Embedding generation" to (log.provenanceEmbeddingGeneration ?: "—"),
    "Submit generation" to (log.provenanceSubmitGeneration ?: "—"),
    "Session token present" to (log.provenanceSessionTokenPresent?.toString() ?: "—"),
    "Hash matches ready" to (log.provenanceHashMatchesReady?.toString() ?: "—"),
    "Generation matches ready" to (log.provenanceGenerationMatchesReady?.toString() ?: "—"),
    "Enrollment diagnostic ID" to (log.enrollmentDiagnosticId ?: "—"),
    "Diagnostic image SHA-256" to (log.enrollmentDiagnosticImageSha256 ?: "—"),
    "Diagnostic tensor SHA-256" to (log.enrollmentDiagnosticTensorSha256 ?: "—"),
)

private fun formatScore(score: Double?): String = score?.let { "%.6f".format(Locale.US, it) } ?: "—"

private fun formatTimestamp(epochMs: Long): String = SimpleDateFormat(
    "yyyy-MM-dd HH:mm:ss.SSS",
    Locale.US,
).format(Date(epochMs))

private fun DateFilter.includes(timestampEpochMs: Long): Boolean {
    if (this == DateFilter.ALL) return true
    val now = Calendar.getInstance()
    val start = Calendar.getInstance().apply {
        set(Calendar.HOUR_OF_DAY, 0)
        set(Calendar.MINUTE, 0)
        set(Calendar.SECOND, 0)
        set(Calendar.MILLISECOND, 0)
    }
    if (this == DateFilter.TODAY) return timestampEpochMs >= start.timeInMillis && timestampEpochMs <= now.timeInMillis
    start.add(Calendar.DAY_OF_YEAR, -6)
    return timestampEpochMs >= start.timeInMillis && timestampEpochMs <= now.timeInMillis
}

package com.faceattend.ai.diagnostics

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.faceattend.ai.BuildConfig
import com.faceattend.ai.face.alignment.AlignmentPoint
import com.faceattend.ai.face.embedding.EmbeddingTensorHasher
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import java.security.MessageDigest

data class EnrollmentInputDiagnosticRecord(
    val id: String,
    val timestampEpochMs: Long,
    val employeeCode: String?,
    val sessionGeneration: String?,
    val cameraFacing: String,
    val sourceImageWidth: Int,
    val sourceImageHeight: Int,
    val cropRect: DiagnosticRect,
    val rotationDegrees: Int,
    val analysisImageWidth: Int,
    val analysisImageHeight: Int,
    val faceBoundingBox: DiagnosticRect,
    val sourceLandmarks: List<AlignmentPoint>,
    val targetLandmarks: List<AlignmentPoint>,
    val alignedWidth: Int,
    val alignedHeight: Int,
    val modelName: String,
    val modelVersion: String,
    val tensorShape: List<Int>,
    val preprocessingFormula: String,
    val channelOrder: String,
    val embeddingDimension: Int,
    val embeddingL2Norm: Float,
    val embeddingProvenanceSha256: String,
    val imageSha256: String,
    val tensorSha256: String,
    val imageFileName: String,
    val metadataFileName: String,
)

class EnrollmentInputDiagnosticRepository(context: Context) {
    private val directory = File(context.applicationContext.filesDir, DIRECTORY_NAME)

    fun record(capture: EnrollmentInputDiagnosticCapture): EnrollmentInputDiagnosticRecord? {
        if (!BuildConfig.DEBUG) return null
        require(capture.alignedBitmap.width == 112 && capture.alignedBitmap.height == 112) {
            "Enrollment diagnostic image must be exactly 112x112"
        }
        require(capture.inputTensor.size == 3 * 112 * 112) {
            "Enrollment diagnostic tensor must be [1,3,112,112]"
        }

        directory.mkdirs()
        val id = UUID.randomUUID().toString()
        val imageFileName = "$id.png"
        val metadataFileName = "$id.json"
        val imageBytes = RgbPngEncoder.encode(capture.alignedBitmap)
        val imageSha256 = sha256(imageBytes)
        val tensorSha256 = EmbeddingTensorHasher.sha256(capture.inputTensor)
        val record = EnrollmentInputDiagnosticRecord(
            id = id,
            timestampEpochMs = capture.timestampEpochMs,
            employeeCode = capture.employeeCode,
            sessionGeneration = capture.sessionGeneration,
            cameraFacing = capture.cameraFacing,
            sourceImageWidth = capture.sourceImageWidth,
            sourceImageHeight = capture.sourceImageHeight,
            cropRect = capture.cropRect,
            rotationDegrees = capture.rotationDegrees,
            analysisImageWidth = capture.analysisImageWidth,
            analysisImageHeight = capture.analysisImageHeight,
            faceBoundingBox = capture.faceBoundingBox,
            sourceLandmarks = capture.sourceLandmarks,
            targetLandmarks = capture.targetLandmarks,
            alignedWidth = capture.alignedBitmap.width,
            alignedHeight = capture.alignedBitmap.height,
            modelName = capture.modelName,
            modelVersion = capture.modelVersion,
            tensorShape = capture.tensorShape,
            preprocessingFormula = capture.preprocessingFormula,
            channelOrder = capture.channelOrder,
            embeddingDimension = capture.embeddingDimension,
            embeddingL2Norm = capture.embeddingL2Norm,
            embeddingProvenanceSha256 = capture.embeddingProvenanceSha256,
            imageSha256 = imageSha256,
            tensorSha256 = tensorSha256,
            imageFileName = imageFileName,
            metadataFileName = metadataFileName,
        )
        val imageFile = File(directory, imageFileName)
        val metadataFile = File(directory, metadataFileName)
        try {
            imageFile.writeBytes(imageBytes)
            metadataFile.writeText(toJson(record).toString(2))
            return record
        } catch (error: Throwable) {
            imageFile.delete()
            metadataFile.delete()
            throw error
        }
    }

    fun all(): List<EnrollmentInputDiagnosticRecord> {
        if (!BuildConfig.DEBUG || !directory.isDirectory) return emptyList()
        return directory.listFiles { file -> file.extension == "json" }
            ?.mapNotNull { file -> runCatching { fromJson(JSONObject(file.readText())) }.getOrNull() }
            ?.sortedByDescending { it.timestampEpochMs }
            .orEmpty()
    }

    fun find(id: String): EnrollmentInputDiagnosticRecord? = all().firstOrNull { it.id == id }

    fun imageFile(record: EnrollmentInputDiagnosticRecord): File? {
        val file = File(directory, record.imageFileName).canonicalFile
        val directoryPath = directory.canonicalFile.path + File.separator
        return file.takeIf { it.isFile && it.path.startsWith(directoryPath) }
    }

    fun image(record: EnrollmentInputDiagnosticRecord): Bitmap? = imageFile(record)?.let { BitmapFactory.decodeFile(it.absolutePath) }

    fun metadataJson(record: EnrollmentInputDiagnosticRecord): String = toJson(record).toString(2)

    fun exportPackage(context: Context, records: List<EnrollmentInputDiagnosticRecord>): File {
        require(BuildConfig.DEBUG) { "Enrollment diagnostics are debug-only" }
        val timestamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        val file = File(context.cacheDir, "faceattend-enrollment-input-diagnostics-$timestamp.zip")
        ZipOutputStream(FileOutputStream(file)).use { zip ->
            records.forEach { record ->
                val image = imageFile(record) ?: return@forEach
                zip.putNextEntry(ZipEntry(record.metadataFileName))
                zip.write(metadataJson(record).toByteArray(Charsets.UTF_8))
                zip.closeEntry()
                zip.putNextEntry(ZipEntry(record.imageFileName))
                image.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
        return file
    }

    fun clear() {
        if (!BuildConfig.DEBUG) return
        directory.listFiles()?.forEach(File::delete)
        directory.delete()
    }

    private fun toJson(record: EnrollmentInputDiagnosticRecord): JSONObject = JSONObject().apply {
        put("id", record.id)
        put("timestamp_epoch_ms", record.timestampEpochMs)
        putNullable("employee_code", record.employeeCode)
        putNullable("session_generation", record.sessionGeneration)
        put("camera_facing", record.cameraFacing)
        put("source_image_width", record.sourceImageWidth)
        put("source_image_height", record.sourceImageHeight)
        put("crop_rect", rectJson(record.cropRect))
        put("rotation_degrees", record.rotationDegrees)
        put("analysis_image_width", record.analysisImageWidth)
        put("analysis_image_height", record.analysisImageHeight)
        put("detected_face_bounding_box", rectJson(record.faceBoundingBox))
        put("source_landmarks", pointsJson(record.sourceLandmarks))
        put("canonical_target_landmarks", pointsJson(record.targetLandmarks))
        put("aligned_crop_width", record.alignedWidth)
        put("aligned_crop_height", record.alignedHeight)
        put("model_name", record.modelName)
        put("model_version", record.modelVersion)
        put("tensor_shape", JSONArray(record.tensorShape))
        put("preprocessing_formula", record.preprocessingFormula)
        put("channel_order", record.channelOrder)
        put("embedding_dimension", record.embeddingDimension)
        put("embedding_l2_norm", record.embeddingL2Norm.toDouble())
        put("embedding_provenance_sha256", record.embeddingProvenanceSha256)
        put("image_sha256", record.imageSha256)
        put("tensor_sha256", record.tensorSha256)
        put("image_file", record.imageFileName)
    }

    private fun fromJson(json: JSONObject): EnrollmentInputDiagnosticRecord = EnrollmentInputDiagnosticRecord(
        id = json.getString("id"),
        timestampEpochMs = json.getLong("timestamp_epoch_ms"),
        employeeCode = json.optString("employee_code").ifBlank { null },
        sessionGeneration = json.optString("session_generation").ifBlank { null },
        cameraFacing = json.getString("camera_facing"),
        sourceImageWidth = json.getInt("source_image_width"),
        sourceImageHeight = json.getInt("source_image_height"),
        cropRect = rectFromJson(json.getJSONObject("crop_rect")),
        rotationDegrees = json.getInt("rotation_degrees"),
        analysisImageWidth = json.getInt("analysis_image_width"),
        analysisImageHeight = json.getInt("analysis_image_height"),
        faceBoundingBox = rectFromJson(json.getJSONObject("detected_face_bounding_box")),
        sourceLandmarks = pointsFromJson(json.getJSONArray("source_landmarks")),
        targetLandmarks = pointsFromJson(json.getJSONArray("canonical_target_landmarks")),
        alignedWidth = json.getInt("aligned_crop_width"),
        alignedHeight = json.getInt("aligned_crop_height"),
        modelName = json.getString("model_name"),
        modelVersion = json.getString("model_version"),
        tensorShape = (0 until json.getJSONArray("tensor_shape").length()).map { json.getJSONArray("tensor_shape").getInt(it) },
        preprocessingFormula = json.getString("preprocessing_formula"),
        channelOrder = json.getString("channel_order"),
        embeddingDimension = json.getInt("embedding_dimension"),
        embeddingL2Norm = json.getDouble("embedding_l2_norm").toFloat(),
        embeddingProvenanceSha256 = json.getString("embedding_provenance_sha256"),
        imageSha256 = json.getString("image_sha256"),
        tensorSha256 = json.getString("tensor_sha256"),
        imageFileName = json.getString("image_file"),
        metadataFileName = "${json.getString("id")}.json",
    )

    private fun rectJson(rect: DiagnosticRect): JSONObject = JSONObject().apply {
        put("left", rect.left)
        put("top", rect.top)
        put("right", rect.right)
        put("bottom", rect.bottom)
    }

    private fun rectFromJson(json: JSONObject): DiagnosticRect = DiagnosticRect(
        json.getInt("left"), json.getInt("top"), json.getInt("right"), json.getInt("bottom"),
    )

    private fun pointsJson(points: List<AlignmentPoint>): JSONArray = JSONArray().apply {
        points.forEachIndexed { index, point ->
            put(JSONObject().apply {
                put("order", LANDMARK_NAMES.getOrElse(index) { "point_$index" })
                put("x", point.x.toDouble())
                put("y", point.y.toDouble())
            })
        }
    }

    private fun pointsFromJson(array: JSONArray): List<AlignmentPoint> = (0 until array.length()).map {
        val point = array.getJSONObject(it)
        AlignmentPoint(point.getDouble("x").toFloat(), point.getDouble("y").toFloat())
    }

    private fun JSONObject.putNullable(key: String, value: String?) {
        put(key, value ?: JSONObject.NULL)
    }

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes)
        .joinToString(separator = "") { byte -> "%02x".format(byte) }

    private companion object {
        const val DIRECTORY_NAME = "enrollment-input-diagnostics"
        val LANDMARK_NAMES = listOf("image_left_eye", "image_right_eye", "nose_base", "image_left_mouth", "image_right_mouth")
    }
}

package com.faceattend.ai.diagnostics

import android.content.Context
import android.content.SharedPreferences
import android.util.Log

interface RecognitionLogStorage {
    fun read(): String?
    fun write(value: String)
    fun clear()
}

private class SharedPreferencesRecognitionLogStorage(context: Context) : RecognitionLogStorage {
    private val preferences: SharedPreferences = context.applicationContext.getSharedPreferences(
        PREFERENCES_NAME,
        Context.MODE_PRIVATE,
    )

    override fun read(): String? = preferences.getString(LOGS_KEY, null)

    override fun write(value: String) {
        preferences.edit().putString(LOGS_KEY, value).apply()
    }

    override fun clear() {
        preferences.edit().remove(LOGS_KEY).apply()
    }

    private companion object {
        const val PREFERENCES_NAME = "faceattend_recognition_logs"
        const val LOGS_KEY = "logs_json"
    }
}

class RecognitionLogRepository internal constructor(
    private val storage: RecognitionLogStorage,
) {
    constructor(context: Context) : this(SharedPreferencesRecognitionLogStorage(context))
    fun all(): List<RecognitionLog> = synchronized(this) {
        runCatching {
            RecognitionLogCodec.decode(storage.read().orEmpty())
                .sortedByDescending { it.timestampEpochMs }
        }.getOrDefault(emptyList())
    }

    fun find(id: String): RecognitionLog? = all().firstOrNull { it.id == id }

    /** Best-effort append. A storage failure is deliberately never propagated. */
    fun record(log: RecognitionLog): Boolean = synchronized(this) {
        runCatching {
            val retained = (listOf(log) + all())
                .distinctBy { it.id }
                .take(MAX_RECOGNITION_LOGS)
            storage.write(RecognitionLogCodec.encode(retained))
        }.onFailure { error ->
            runCatching {
                Log.e(
                    TAG,
                    "record failed: ${error::class.java.name}: ${error.message}",
                )
            }
        }.isSuccess
    }

    fun clear(): Boolean = synchronized(this) {
        runCatching { storage.clear() }.isSuccess
    }

    fun exportJson(): String = RecognitionLogCodec.encode(all())

    fun exportText(): String = RecognitionLogFormatter.toText(all())

    private companion object {
        const val TAG = "RecognitionLogRepository"
    }
}

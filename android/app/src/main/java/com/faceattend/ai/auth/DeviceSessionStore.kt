package com.faceattend.ai.auth

import android.content.Context
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties

/** Keystore-backed encrypted storage for the device session, never for the password. */
class DeviceSessionStore(context: Context) {
    private val preferences = context.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

    fun save(session: DeviceSession) {
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val encrypted = cipher.doFinal(session.toJson().toByteArray(StandardCharsets.UTF_8))
            preferences.edit()
                .putString(IV_KEY, Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
                .putString(DATA_KEY, Base64.encodeToString(encrypted, Base64.NO_WRAP))
                .apply()
        } catch (exception: Exception) {
            AuthDiagnostics.logException("SESSION_STORE_WRITE", exception)
            throw exception
        }
    }

    fun load(): DeviceSession? {
        val encodedIv = preferences.getString(IV_KEY, null) ?: return null
        val encodedData = preferences.getString(DATA_KEY, null) ?: return null
        return runCatching {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(
                Cipher.DECRYPT_MODE,
                key(),
                GCMParameterSpec(GCM_TAG_LENGTH_BITS, Base64.decode(encodedIv, Base64.NO_WRAP)),
            )
            val json = cipher.doFinal(Base64.decode(encodedData, Base64.NO_WRAP))
                .toString(StandardCharsets.UTF_8)
            DeviceSession.fromStoredJson(json)
        }.getOrElse {
            AuthDiagnostics.logException("SESSION_STORE_READ", it)
            clear()
            null
        }
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun key(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .build(),
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "faceattend_device_session_key"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val GCM_TAG_LENGTH_BITS = 128
        const val PREFERENCES_NAME = "faceattend_device_session"
        const val IV_KEY = "iv"
        const val DATA_KEY = "ciphertext"
    }
}

package xyz.amasuda.tky

import android.content.SharedPreferences

/** Keeps the user's Claude API key (and an optional model override) on the device. */
interface ApiKeyStore {
    /** The stored key, or "" when there is none. */
    fun apiKey(): String

    /** The model to read with, or "" for the page's default. */
    fun model(): String

    /** Stores [key] in place of any earlier one. */
    fun saveApiKey(key: String)

    /** Removes the stored key, so the next reading asks for one. */
    fun forgetApiKey()
}

/** An [ApiKeyStore] in the app's private shared preferences. */
class PreferencesApiKeyStore(private val prefs: SharedPreferences) : ApiKeyStore {
    override fun apiKey(): String = prefs.getString(KEY_API_KEY, null).orEmpty()

    override fun model(): String = prefs.getString(KEY_MODEL, null).orEmpty()

    override fun saveApiKey(key: String) {
        prefs.edit().putString(KEY_API_KEY, key).apply()
    }

    override fun forgetApiKey() {
        prefs.edit().remove(KEY_API_KEY).apply()
    }

    private companion object {
        const val KEY_API_KEY = "claude_api_key"
        const val KEY_MODEL = "claude_model"
    }
}

/** Checks of what the user types as an API key. */
object ApiKeys {
    private val pattern = Regex("^sk-ant-[A-Za-z0-9_-]{20,300}$")

    /** The key in [input] without surrounding spaces, or null when it does not look like a Claude API key. */
    fun normalize(input: String): String? = input.trim().takeIf(pattern::matches)
}

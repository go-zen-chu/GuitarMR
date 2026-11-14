package xyz.amasuda.tky

import android.content.SharedPreferences
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** Keeps the user's Claude API key (and an optional model override) on the device. */
interface ApiKeyStore {
    /** The stored key, or "" when there is none. */
    fun apiKey(): String

    /** The model to read with, or "" for the page's default. */
    fun model(): String

    /** The day the stored key was saved, or null when there is no key or it was saved before the day was kept. */
    fun savedOn(): LocalDate?

    /** Stores [key] in place of any earlier one, saved today. */
    fun saveApiKey(key: String)

    /** Removes the stored key, so the next reading asks for one. */
    fun forgetApiKey()
}

/** An [ApiKeyStore] in the app's private shared preferences; [today] dates each saved key. */
class PreferencesApiKeyStore(
    private val prefs: SharedPreferences,
    private val today: () -> LocalDate = LocalDate::now,
) : ApiKeyStore {
    override fun apiKey(): String = prefs.getString(KEY_API_KEY, null).orEmpty()

    override fun model(): String = prefs.getString(KEY_MODEL, null).orEmpty()

    override fun savedOn(): LocalDate? =
        if (prefs.contains(KEY_API_KEY) && prefs.contains(KEY_SAVED_ON)) LocalDate.ofEpochDay(prefs.getLong(KEY_SAVED_ON, 0)) else null

    override fun saveApiKey(key: String) {
        prefs.edit().putString(KEY_API_KEY, key).putLong(KEY_SAVED_ON, today().toEpochDay()).apply()
    }

    override fun forgetApiKey() {
        prefs.edit().remove(KEY_API_KEY).remove(KEY_SAVED_ON).apply()
    }

    private companion object {
        const val KEY_API_KEY = "claude_api_key"
        const val KEY_MODEL = "claude_model"
        const val KEY_SAVED_ON = "claude_api_key_saved_on"
    }
}

/** Checks of what the user types as an API key. */
object ApiKeys {
    private val pattern = Regex("^sk-ant-[A-Za-z0-9_-]{20,300}$")

    /** The key in [input] without surrounding spaces, or null when it does not look like a Claude API key. */
    fun normalize(input: String): String? = input.trim().takeIf(pattern::matches)

    /** Enough of [key] to tell it apart from the user's other keys (as the Claude Console lists them), but not to use it. */
    fun preview(key: String): String = if (key.length <= PREVIEW_HEAD + PREVIEW_TAIL) "…" else "${key.take(PREVIEW_HEAD)}…${key.takeLast(PREVIEW_TAIL)}"

    /** Whole days from [savedOn] to [today]. */
    fun daysSince(savedOn: LocalDate, today: LocalDate): Long = ChronoUnit.DAYS.between(savedOn, today)

    /** "sk-ant-api03-" and the first characters that differ between keys. */
    private const val PREVIEW_HEAD = 17
    private const val PREVIEW_TAIL = 4
}

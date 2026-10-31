package xyz.amasuda.tky

import android.webkit.JavascriptInterface

/** How a save through the file picker ended. */
enum class SaveOutcome(val error: String?) {
    SAVED(null),
    DECLINED("declined"),
    FAILED("failed"),
}

/** What the app does for the page with the user: ask for a key, pick where a file goes. */
interface PageHost {
    /** Ask for an API key; [onResult] gets the checked key, or "" when the user cancels. */
    fun askApiKey(onResult: (String) -> Unit)

    /** Let the user pick where [data] goes as [filename]; [onResult] gets how it ended. */
    fun save(filename: String, mimeType: String, data: String, onResult: (SaveOutcome) -> Unit)
}

/** Reports a finished call back into the page. */
fun interface PageCallback {
    /** Finish the page's call [callId] with [error] (a sample error code) or [value]. */
    fun settle(callId: String, error: String?, value: String)
}

/**
 * The page's view of the app (`GuitarMRAndroid` in web/packages/demo/src/android-host.ts).
 * Methods run on WebView's bridge thread; long calls finish later through [page].
 */
class HostBridge(
    private val keys: ApiKeyStore,
    private val host: PageHost,
    private val page: PageCallback,
) {
    /** The stored API key, or "". */
    @JavascriptInterface
    fun apiKey(): String = keys.apiKey()

    /** The model override, or "" for the page's default. */
    @JavascriptInterface
    fun model(): String = keys.model()

    /** Asks the user for a key; the call settles with it, or "" when they cancel. */
    @JavascriptInterface
    fun askApiKey(callId: String) {
        if (!isCallId(callId)) return
        host.askApiKey { key -> page.settle(callId, null, key) }
    }

    /** Drops a key the API rejected. */
    @JavascriptInterface
    fun forgetApiKey() {
        keys.forgetApiKey()
    }

    /** Saves [data] where the user picks; the call settles as saved, or fails as declined or failed. */
    @JavascriptInterface
    fun save(callId: String, filename: String, mimeType: String, data: String) {
        if (!isCallId(callId)) return
        val name = safeFilename(filename)
        if (name == null || !MIME_TYPE.matches(mimeType)) {
            page.settle(callId, SaveOutcome.FAILED.error, "")
            return
        }
        host.save(name, mimeType, data) { outcome -> page.settle(callId, outcome.error, outcome.name.lowercase()) }
    }

    companion object {
        private val CALL_ID = Regex("^c[0-9]{1,9}$")
        private val MIME_TYPE = Regex("^[a-z]+/[a-z0-9.+-]+$")

        /** Whether [value] is a call id as the page makes them. */
        fun isCallId(value: String) = CALL_ID.matches(value)

        /** [filename] as a plain file name for the picker, or null when nothing usable is left. */
        fun safeFilename(filename: String): String? =
            filename.substringAfterLast('/').substringAfterLast('\\')
                .filter { it >= ' ' && it !in "<>:\"|?*" }
                .trim().trimStart('.')
                .take(120)
                .ifEmpty { null }
    }
}

package xyz.amasuda.tky

import java.net.URI

/** The origin WebView reserves for app assets; the phone page runs there as a secure context. */
const val PAGE_ORIGIN = "https://appassets.androidplatform.net"
const val PAGE_URL = "$PAGE_ORIGIN/"

/** A bundled file that answers a page request. */
data class PageAsset(val path: String, val mimeType: String)

/** Maps requests of the page to the files bundled under [root] in the app's assets. */
class PageAssets(private val root: String = "web") {

    /** The bundled file for [url], or null when the URL is not the page's own. */
    fun resolve(url: String): PageAsset? {
        val uri = parse(url) ?: return null
        if (!isPage(uri)) return null
        val path = uri.path.orEmpty().removePrefix("/").ifEmpty { "index.html" }
        if (path.split('/').any { it == ".." || it.isEmpty() }) return null
        return PageAsset("$root/$path", mimeTypeOf(path))
    }

    /** Whether [url] belongs to the page (and stays in the app) rather than to the outside web. */
    fun isPageUrl(url: String): Boolean = parse(url)?.let(::isPage) ?: false

    private fun isPage(uri: URI) = uri.scheme == "https" && uri.host == URI(PAGE_ORIGIN).host && uri.port == -1

    private fun parse(url: String): URI? = runCatching { URI(url) }.getOrNull()

    private fun mimeTypeOf(path: String): String = when (path.substringAfterLast('.', "").lowercase()) {
        "html" -> "text/html"
        "js", "mjs" -> "text/javascript"
        "json" -> "application/json"
        "css" -> "text/css"
        "wasm" -> "application/wasm"
        "png" -> "image/png"
        "svg" -> "image/svg+xml"
        else -> "application/octet-stream"
    }
}

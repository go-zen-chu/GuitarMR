package xyz.amasuda.tky

/** The MIME types a file picker is opened with for an `<input accept>`; any file when it names none. */
fun chooserMimeTypes(acceptTypes: Array<String>?): List<String> {
    val types = acceptTypes.orEmpty()
        .flatMap { it.split(',') }
        .map { it.trim().lowercase() }
        .filter { it.isNotEmpty() }
        .map { if (it.startsWith(".")) EXTENSIONS[it] ?: "*/*" else it }
        .distinct()
    return if (types.isEmpty() || "*/*" in types) listOf("*/*") else types
}

/** Whether an `<input capture>` asks for the camera: only for images. */
fun capturesPhoto(captureEnabled: Boolean, acceptTypes: Array<String>?): Boolean =
    captureEnabled && chooserMimeTypes(acceptTypes).all { it.startsWith("image/") }

private val EXTENSIONS = mapOf(
    ".pdf" to "application/pdf",
    ".json" to "application/json",
    ".jpg" to "image/jpeg",
    ".jpeg" to "image/jpeg",
    ".png" to "image/png",
)

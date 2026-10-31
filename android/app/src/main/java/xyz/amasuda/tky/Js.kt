package xyz.amasuda.tky

/** [value] as a JavaScript string literal (JSON rules), or `null`. */
fun jsString(value: String?): String {
    if (value == null) return "null"
    val out = StringBuilder(value.length + 2).append('"')
    for (c in value) {
        when (c) {
            '"' -> out.append("\\\"")
            '\\' -> out.append("\\\\")
            '\n' -> out.append("\\n")
            '\r' -> out.append("\\r")
            '\t' -> out.append("\\t")
            // Line and paragraph separators end a line in older JavaScript string literals.
            ' ', ' ', '<' -> out.append("\\u%04x".format(c.code))
            else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
        }
    }
    return out.append('"').toString()
}

/** The script that settles call [callId] in the page (see `settle` in android-host.ts). */
fun settleScript(callId: String, error: String?, value: String): String =
    "globalThis.claude && globalThis.claude.settle(${jsString(callId)}, ${jsString(error)}, ${jsString(value)});"

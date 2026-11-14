package xyz.amasuda.tky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

class SmallPartsTest {

    @Test
    fun `If a key is typed with spaces around it it should be kept without them`() {
        val key = "sk-ant-api03-" + "a".repeat(40)
        assertEquals(key, ApiKeys.normalize("  $key\n"))
    }

    @Test
    fun `If something else is typed as a key it should be refused`() {
        for (input in listOf("", "sk-ant-short", "sk-proj-" + "a".repeat(40), "sk-ant-" + "a".repeat(30) + " x")) {
            assertNull(input, ApiKeys.normalize(input))
        }
    }

    @Test
    fun `If a key is shown it should keep only its first characters and last four`() {
        val key = "sk-ant-api03-AbCd" + "x".repeat(80) + "WXYZ"
        assertEquals("sk-ant-api03-AbCd…WXYZ", ApiKeys.preview(key))
        assertEquals("…", ApiKeys.preview("sk-ant-short"))
    }

    @Test
    fun `If a key was saved some days ago it should count the whole days since`() {
        assertEquals(0L, ApiKeys.daysSince(LocalDate.of(2026, 11, 13), LocalDate.of(2026, 11, 13)))
        assertEquals(31L, ApiKeys.daysSince(LocalDate.of(2026, 10, 13), LocalDate.of(2026, 11, 13)))
    }

    @Test
    fun `If a value has quotes, newlines or a closing script tag it should stay one safe string literal`() {
        assertEquals("\"a\\\"b\\\\c\\nd\\u003c/script>\\u2028\"", jsString("a\"b\\c\nd</script>\u2028"))
        assertEquals("null", jsString(null))
    }

    @Test
    fun `If a call settles it should call the page host with the quoted values`() {
        assertEquals(
            "globalThis.claude && globalThis.claude.settle(\"c1\", null, \"saved\");",
            settleScript("c1", null, "saved"),
        )
    }

    @Test
    fun `If back is pressed it should ask the page and be false without the page's handler`() {
        assertEquals("globalThis.tky ? globalThis.tky.back() : false;", BACK_SCRIPT)
    }

    @Test
    fun `If an input accepts anything it should open the picker for any file`() {
        assertEquals(listOf("*/*"), chooserMimeTypes(arrayOf("")))
        assertEquals(listOf("*/*"), chooserMimeTypes(null))
        assertEquals(listOf("*/*"), chooserMimeTypes(arrayOf("image/*", "*/*")))
    }

    @Test
    fun `If an input lists types and extensions it should open the picker for their MIME types`() {
        assertEquals(listOf("image/*", "application/pdf"), chooserMimeTypes(arrayOf("image/*, .pdf")))
    }

    @Test
    fun `If a capture input accepts images only it should use the camera`() {
        assertTrue(capturesPhoto(true, arrayOf("image/*")))
        assertFalse(capturesPhoto(false, arrayOf("image/*")))
        assertFalse(capturesPhoto(true, arrayOf("")))
    }
}

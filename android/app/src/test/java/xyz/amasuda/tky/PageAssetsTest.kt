package xyz.amasuda.tky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PageAssetsTest {
    private val assets = PageAssets()

    @Test
    fun `If the page root is requested it should serve index html`() {
        assertEquals(PageAsset("web/index.html", "text/html"), assets.resolve(PAGE_URL))
    }

    @Test
    fun `If pdf js is requested it should serve the bundled module as JavaScript`() {
        assertEquals(
            PageAsset("web/pdfjs/pdf.worker.min.mjs", "text/javascript"),
            assets.resolve("$PAGE_ORIGIN/pdfjs/pdf.worker.min.mjs?v=1"),
        )
    }

    @Test
    fun `If a URL climbs out of the page directory it should not be served`() {
        assertNull(assets.resolve("$PAGE_ORIGIN/../shared_prefs/tky.xml"))
        assertNull(assets.resolve("$PAGE_ORIGIN/pdfjs//pdf.min.mjs"))
    }

    @Test
    fun `If a URL is not on the page origin it should go to the network`() {
        for (url in listOf(
            "https://api.anthropic.com/v1/messages",
            "http://appassets.androidplatform.net/",
            "https://appassets.androidplatform.net:8443/",
            "not a url",
        )) {
            assertNull(url, assets.resolve(url))
            assertFalse(url, assets.isPageUrl(url))
        }
        assertTrue(assets.isPageUrl("$PAGE_ORIGIN/#play"))
    }
}

package xyz.amasuda.tky

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HostBridgeTest {

    private class MemoryKeys(var key: String = "") : ApiKeyStore {
        override fun apiKey() = key
        override fun model() = ""
        override fun saveApiKey(key: String) {
            this.key = key
        }
        override fun forgetApiKey() {
            key = ""
        }
    }

    /** A host that answers at once with [key] and [outcome], keeping what it was asked to save. */
    private class FakeHost(val key: String = "", val outcome: SaveOutcome = SaveOutcome.SAVED) : PageHost {
        val saved = mutableListOf<Triple<String, String, String>>()
        override fun askApiKey(onResult: (String) -> Unit) = onResult(key)
        override fun save(filename: String, mimeType: String, data: String, onResult: (SaveOutcome) -> Unit) {
            saved += Triple(filename, mimeType, data)
            onResult(outcome)
        }
    }

    private class Settled : PageCallback {
        val calls = mutableListOf<Triple<String, String?, String>>()
        override fun settle(callId: String, error: String?, value: String) {
            calls += Triple(callId, error, value)
        }
    }

    private fun bridge(keys: ApiKeyStore = MemoryKeys(), host: PageHost = FakeHost(), page: Settled = Settled()) =
        HostBridge(keys, host, page)

    @Test
    fun `If the user enters a key it should settle the call with it`() {
        val page = Settled()
        bridge(host = FakeHost(key = "sk-ant-x"), page = page).askApiKey("c1")
        assertEquals(listOf(Triple("c1", null, "sk-ant-x")), page.calls)
    }

    @Test
    fun `If the page forgets the key it should be gone from the store`() {
        val keys = MemoryKeys("sk-ant-old")
        bridge(keys = keys).forgetApiKey()
        assertEquals("", keys.apiKey())
    }

    @Test
    fun `If a save is declined it should settle with the declined error`() {
        val page = Settled()
        val host = FakeHost(outcome = SaveOutcome.DECLINED)
        bridge(host = host, page = page).save("c2", "song.gts.json", "application/json", "{}")
        assertEquals(listOf(Triple("song.gts.json", "application/json", "{}")), host.saved)
        assertEquals(listOf(Triple<String, String?, String>("c2", "declined", "declined")), page.calls)
    }

    @Test
    fun `If a save names a path it should save under the bare file name`() {
        val host = FakeHost()
        bridge(host = host).save("c3", "../../etc/song.gts.json", "application/json", "{}")
        assertEquals("song.gts.json", host.saved.single().first)
    }

    @Test
    fun `If a save has no usable name or type it should fail without asking the user`() {
        val page = Settled()
        val host = FakeHost()
        val bridge = bridge(host = host, page = page)
        bridge.save("c4", "...", "application/json", "{}")
        bridge.save("c5", "a.json", "text/html; charset=utf-8", "{}")
        assertEquals(emptyList<Any>(), host.saved)
        assertEquals(listOf("failed", "failed"), page.calls.map { it.second })
    }

    @Test
    fun `If a call id is not one the page makes it should be ignored`() {
        val page = Settled()
        bridge(page = page).askApiKey("x\"); alert(1); (\"")
        assertEquals(emptyList<Any>(), page.calls)
    }

    @Test
    fun `If a file name is given it should keep only a plain name`() {
        assertEquals("guitarmr-library-2026-10-28.jsonl", HostBridge.safeFilename("guitarmr-library-2026-10-28.jsonl"))
        assertEquals("a b.json", HostBridge.safeFilename("C:\\x\\a b.json"))
        assertNull(HostBridge.safeFilename("/"))
    }
}

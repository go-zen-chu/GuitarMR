/** The Android app's host: the Claude API sample and the bridge to the app. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type AndroidBridge, createAndroidHost, mimeTypeOf } from "../src/android-host.ts";
import { codeOfStatus, createApiSample, jsonOfReply } from "../src/api-sample.ts";
import type { Sample } from "../src/reader.ts";

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: { model: string; messages: { content: { type: string; text?: string; source?: { data: string; media_type: string } }[] }[] };
}

/** A fetch answering every request with `status` and `body`, keeping what was sent. */
function fakeFetch(status: number, body: unknown) {
  const sent: Sent[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, sent };
}

const reply = (text: string, stopReason = "end_turn") => ({ stop_reason: stopReason, content: [{ type: "text", text }] });

/** A bridge that records what the page asked of the app; the app's answers are given by the test. */
function fakeBridge(key = "sk-test") {
  const asked: string[] = [];
  const saves: { callId: string; filename: string; mimeType: string; data: string }[] = [];
  let forgotten = 0;
  const bridge: AndroidBridge = {
    apiKey: () => key,
    model: () => "",
    askApiKey: (callId) => asked.push(callId),
    forgetApiKey: () => {
      forgotten++;
    },
    save: (callId, filename, mimeType, data) => saves.push({ callId, filename, mimeType, data }),
  };
  return { bridge, asked, saves, forgotten: () => forgotten };
}

const rejection = (promise: Promise<unknown>) => promise.then(() => assert.fail("should reject"), (e: { code: string }) => e.code);

describe("api sample", () => {
  it("If a prompt with images is sent it should post them before the text with the key and the browser access header", async () => {
    const fetch = fakeFetch(200, reply('{"measures":[]}'));
    const sample = createApiSample({ apiKey: async () => "sk-test", fetch: fetch.impl });
    const answer = await sample.json("read this", { images: [new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" })] });
    assert.deepEqual(answer, { measures: [] });
    const [sent] = fetch.sent;
    assert.equal(sent!.url, "https://api.anthropic.com/v1/messages");
    assert.equal(sent!.headers["x-api-key"], "sk-test");
    assert.equal(sent!.headers["anthropic-dangerous-direct-browser-access"], "true");
    assert.equal(sent!.body.model, "claude-opus-5-5");
    const content = sent!.body.messages[0]!.content;
    assert.deepEqual(content.map((c) => c.type), ["image", "text"]);
    assert.deepEqual(content[0]!.source, { type: "base64", media_type: "image/jpeg", data: "AQID" });
  });

  it("If there is no key it should fail as invalid_api_key without calling the API", async () => {
    const fetch = fakeFetch(200, reply("{}"));
    const sample = createApiSample({ apiKey: async () => "", fetch: fetch.impl });
    assert.equal(await rejection(sample.json("x")), "invalid_api_key");
    assert.equal(fetch.sent.length, 0);
  });

  it("If the API refuses it should fail as refused", async () => {
    const sample = createApiSample({ apiKey: async () => "k", fetch: fakeFetch(200, reply("", "refusal")).impl });
    assert.equal(await rejection(sample.json("x")), "refused");
  });

  it("If the API answers an error status it should fail with the matching sample code", async () => {
    const sample = createApiSample({ apiKey: async () => "k", fetch: fakeFetch(429, "slow down").impl });
    assert.equal(await rejection(sample.json("x")), "rate_limited");
  });

  it("If statuses are given it should map them like the claude.ai sample errors", () => {
    const cases: [number, string, string][] = [
      [401, "", "invalid_api_key"],
      [403, "", "invalid_api_key"],
      [429, "", "rate_limited"],
      [413, "", "prompt_too_large"],
      [400, "Could not process image", "image_rejected"],
      [400, "prompt is too long", "prompt_too_large"],
      [529, "overloaded", "upstream_error"],
    ];
    for (const [status, body, code] of cases) assert.equal(codeOfStatus(status, body), code, `${status} ${body}`);
  });

  it("If a reply wraps its JSON in a fence or prose it should still read the JSON", () => {
    assert.deepEqual(jsonOfReply('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(jsonOfReply('Here it is: {"a":2} done'), { a: 2 });
    assert.throws(() => jsonOfReply("no json here"), { code: "invalid_json" });
  });
});

describe("android host", () => {
  it("If the page asks for sample and downloads it should get both, and nothing else", async () => {
    const host = createAndroidHost(fakeBridge().bridge);
    assert.ok(await host.use("sample"));
    assert.ok(await host.use("downloads"));
    assert.equal(await host.use("other"), null);
  });

  it("If no key is stored it should ask the app and read with the key the user entered", async () => {
    const fake = fakeBridge("");
    const fetch = fakeFetch(200, reply('{"ok":true}'));
    const host = createAndroidHost(fake.bridge, fetch.impl);
    const sample = (await host.use("sample")) as Sample;
    const answer = sample.json("x");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(fake.asked.length, 1);
    host.settle(fake.asked[0]!, null, "sk-entered");
    assert.deepEqual(await answer, { ok: true });
    assert.equal(fetch.sent[0]!.headers["x-api-key"], "sk-entered");
  });

  it("If the API rejects the key it should make the app forget it", async () => {
    const fake = fakeBridge();
    const host = createAndroidHost(fake.bridge, fakeFetch(401, "invalid x-api-key").impl);
    const sample = (await host.use("sample")) as Sample;
    assert.equal(await rejection(sample.json("x")), "invalid_api_key");
    assert.equal(fake.forgotten(), 1);
  });

  it("If a save is declined in the app it should reject with declined, and resolve as saved otherwise", async () => {
    const fake = fakeBridge();
    const host = createAndroidHost(fake.bridge);
    const downloads = (await host.use("downloads")) as { save(r: { filename: string; data: string }): Promise<{ status: string }> };
    const declined = downloads.save({ filename: "song.gts.json", data: "{}" });
    const saved = downloads.save({ filename: "lib.jsonl", data: "x\n" });
    assert.deepEqual(
      fake.saves.map((s) => [s.filename, s.mimeType]),
      [
        ["song.gts.json", "application/json"],
        ["lib.jsonl", "application/jsonl"],
      ],
    );
    host.settle(fake.saves[0]!.callId, "declined", "");
    host.settle(fake.saves[1]!.callId, null, "saved");
    assert.equal(await rejection(declined), "declined");
    assert.deepEqual(await saved, { status: "saved" });
  });

  it("If a filename has no known extension it should save as octet-stream", () => {
    assert.equal(mimeTypeOf("photo.bin"), "application/octet-stream");
  });
});

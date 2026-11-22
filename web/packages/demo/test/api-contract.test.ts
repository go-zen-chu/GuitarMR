/**
 * Contract tests for reading with Claude, where money is spent (ADR-012).
 *
 * - The Messages API side (external spec): what is sent, and how each kind
 *   of answer in testdata/messages is taken, billed ones included.
 * - The `Sample` side: what the reader relies on, checked against every
 *   implementation the page can be given on the API.
 *
 * A change here changes what a reading costs or what is lost to a failure:
 * update ADR-012 with it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type AndroidBridge, createAndroidHost } from "../src/android-host.ts";
import { API_URL, DEFAULT_MODEL, PRICES, createApiSample } from "../src/api-sample.ts";
import type { Sample, Spent } from "../src/reader.ts";
import { withRetries } from "../src/retry.ts";

const fixture = (name: string): string => readFileSync(new URL(`testdata/messages/${name}.json`, import.meta.url), "utf8");

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown> & { messages: { role: string; content: { type: string; text?: string; source?: Record<string, string> }[] }[] };
}

/** A fetch answering the requests in turn with `answers` (the last one repeats), keeping what was sent. */
function apiReplying(...answers: { status: number; fixture: string }[]) {
  const sent: Sent[] = [];
  const fetch: typeof globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const answer = answers[Math.min(sent.length - 1, answers.length - 1)]!;
    return new Response(fixture(answer.fixture), { status: answer.status });
  }) as unknown as typeof fetch;
  return { fetch, sent };
}

const ok = (name = "end-turn") => ({ status: 200, fixture: name });

const codeOf = (promise: Promise<unknown>) =>
  promise.then(
    () => assert.fail("should reject"),
    (e: { code: unknown; message: unknown }) => {
      assert.equal(typeof e.code, "string");
      assert.equal(typeof e.message, "string");
      return e.code;
    },
  );

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

/** A bridge with a stored key, for the app's host. */
const bridge = (): AndroidBridge => ({
  apiKey: () => "sk-contract",
  model: () => "",
  askApiKey: () => undefined,
  forgetApiKey: () => undefined,
  showApiKeySettings: () => undefined,
  save: () => undefined,
});

describe("Messages API request (external spec)", () => {
  it("If a reading request is sent it should carry only the model, the token cap and one user turn of images then text", async () => {
    const api = apiReplying(ok());
    await createApiSample({ apiKey: async () => "sk-contract", fetch: api.fetch }).json("read", { images: [image(), image()] });
    const [sent] = api.sent;
    assert.equal(sent!.url, API_URL);
    assert.deepEqual(sent!.headers, {
      "content-type": "application/json",
      "x-api-key": "sk-contract",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
    // No thinking, effort or output format: each changes the bill, so adding one is an ADR-012 decision.
    assert.deepEqual(Object.keys(sent!.body).sort(), ["max_tokens", "messages", "model"]);
    assert.equal(sent!.body.model, DEFAULT_MODEL);
    assert.equal(sent!.body.max_tokens, 16000);
    assert.equal(sent!.body.messages.length, 1);
    assert.equal(sent!.body.messages[0]!.role, "user");
    assert.deepEqual(
      sent!.body.messages[0]!.content.map((c) => c.type),
      ["image", "image", "text"],
    );
    assert.doesNotMatch(sent!.body.messages[0]!.content[0]!.source!.data!, /\s/);
  });

  it("If the app sets a model it should read with that model", async () => {
    const api = apiReplying(ok());
    await createApiSample({ apiKey: async () => "k", model: "claude-sonnet-5-5", fetch: api.fetch }).json("x");
    assert.equal(api.sent[0]!.body.model, "claude-sonnet-5-5");
  });

  it("If the default model is used it should have a known price, so a reading's cost can be shown", () => {
    assert.ok(PRICES[DEFAULT_MODEL]);
  });
});

describe("Messages API response (external spec)", () => {
  it("If the answer ends normally it should give the JSON of its text, past the thinking block", async () => {
    const answer = await createApiSample({ apiKey: async () => "k", fetch: apiReplying(ok()).fetch }).json("x");
    assert.deepEqual(answer, { measures: [{ id: "m1", tab: "4:6-0", confidence: 0.9 }] });
  });

  it("If each kind of answer comes back it should fail with the code the reader acts on", async () => {
    const cases: [number, string, string][] = [
      [200, "max-tokens", "truncated"],
      [200, "refusal", "refused"],
      [401, "error-authentication", "invalid_api_key"],
      [400, "error-credit", "no_credit"],
      [429, "error-rate-limit", "rate_limited"],
      [529, "error-overloaded", "upstream_error"],
      [404, "error-not-found", "model_unavailable"],
    ];
    for (const [status, name, code] of cases) {
      const sample = createApiSample({ apiKey: async () => "k", fetch: apiReplying({ status, fixture: name }).fetch });
      assert.equal(await codeOf(sample.json("x")), code, name);
    }
  });

  it("If answers are billed it should count each of them, cut-off and refused ones too, at the model's price", async () => {
    const api = apiReplying(ok(), ok("max-tokens"), ok("refusal"));
    const sample = createApiSample({ apiKey: async () => "k", fetch: api.fetch });
    await sample.json("x");
    await codeOf(sample.json("x"));
    await codeOf(sample.json("x"));
    const spent = sample.spent();
    const input = 2400 + 9000 + 2400;
    const output = 1800 + 16000 + 10;
    assert.deepEqual({ ...spent, usd: 0 }, { requests: 3, inputTokens: input, outputTokens: output, usd: 0 });
    assert.ok(Math.abs(spent.usd! - (input * 4 + output * 20) / 1e6) < 1e-9);
  });

  it("If the API refuses the request with an error status it should not count it as spent", async () => {
    const sample = createApiSample({ apiKey: async () => "k", fetch: apiReplying({ status: 429, fixture: "error-rate-limit" }).fetch });
    await codeOf(sample.json("x"));
    assert.equal(sample.spent().requests, 0);
  });
});

/** The `Sample` contract, for one implementation over the API. */
function sampleContract(name: string, make: (fetch: typeof globalThis.fetch) => Promise<Sample>) {
  describe(`Sample contract: ${name}`, () => {
    it("If asked with images it should allow at least one image per request", async () => {
      const sample = await make(apiReplying(ok()).fetch);
      assert.ok(((await sample.limits()).images?.maxCount ?? 0) >= 1);
    });

    it("If Claude answers it should resolve to the parsed JSON", async () => {
      const sample = await make(apiReplying(ok()).fetch);
      assert.deepEqual(await sample.json("x", { images: [image()] }), { measures: [{ id: "m1", tab: "4:6-0", confidence: 0.9 }] });
    });

    it("If it fails it should reject with a string code and message", async () => {
      const sample = await make(apiReplying(ok("max-tokens")).fetch);
      assert.equal(await codeOf(sample.json("x")), "truncated");
    });

    it("If a billed failure happens it should not ask again, so it is billed once", async () => {
      const api = apiReplying(ok("max-tokens"));
      const sample = await make(api.fetch);
      await codeOf(sample.json("x"));
      assert.equal(api.sent.length, 1);
    });

    it("If requests are made it should tell what they spent, never less than before", async () => {
      const sample = await make(apiReplying(ok(), ok("max-tokens")).fetch);
      const seen: Spent[] = [sample.spent!()];
      await sample.json("x");
      seen.push(sample.spent!());
      await codeOf(sample.json("x"));
      seen.push(sample.spent!());
      assert.deepEqual(
        seen.map((s) => s.requests),
        [0, 1, 2],
      );
      for (let i = 1; i < seen.length; i++) {
        assert.ok(seen[i]!.inputTokens >= seen[i - 1]!.inputTokens);
        assert.ok(seen[i]!.outputTokens >= seen[i - 1]!.outputTokens);
        assert.ok(seen[i]!.usd! >= seen[i - 1]!.usd!);
      }
    });
  });
}

sampleContract("the API sample", async (fetch) => createApiSample({ apiKey: async () => "k", fetch }));
sampleContract("the Android app's host", async (fetch) => (await createAndroidHost(bridge(), fetch).use("sample")) as Sample);
sampleContract("the API sample asking again", async (fetch) =>
  withRetries(createApiSample({ apiKey: async () => "k", fetch }), [0, 0]),
);

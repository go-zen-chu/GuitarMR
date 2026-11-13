/** Asking Claude again after failures that often pass on their own. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Sample } from "../src/reader.ts";
import { pause, withRetries } from "../src/retry.ts";

/** A sample failing with each of `codes` in turn, then answering "ok"; it counts the requests. */
function failingThen(codes: string[]) {
  let calls = 0;
  const sample: Sample = {
    limits: async () => ({ images: { maxCount: 20 } }),
    json: async <T>() => {
      const code = codes[calls++];
      if (code) throw { code, message: `${code} #${calls}` };
      return "ok" as T;
    },
  };
  return { sample, calls: () => calls };
}

/** A pause that returns at once, keeping how long it was asked to wait. */
function noWait() {
  const waited: number[] = [];
  return { waited, wait: async (ms: number) => void waited.push(ms) };
}

describe("withRetries", () => {
  it("If a request fails to reach Claude once it should ask again after a pause and answer", async () => {
    const { sample, calls } = failingThen(["upstream_error"]);
    const { waited, wait } = noWait();
    assert.equal(await withRetries(sample, [10, 20], wait).json("q"), "ok");
    assert.equal(calls(), 2);
    assert.deepEqual(waited, [10]);
  });

  it("If every try fails to reach Claude it should give up with the last failure", async () => {
    const { sample, calls } = failingThen(["upstream_error", "overloaded", "upstream_error"]);
    const { waited, wait } = noWait();
    await assert.rejects(withRetries(sample, [10, 20], wait).json("q"), { code: "upstream_error", message: "upstream_error #3" });
    assert.equal(calls(), 3);
    assert.deepEqual(waited, [10, 20]);
  });

  it("If the usage limit or the key is the problem it should not ask again", async () => {
    for (const code of ["rate_limited", "invalid_api_key", "invalid_json"]) {
      const { sample, calls } = failingThen([code]);
      await assert.rejects(withRetries(sample, [10], noWait().wait).json("q"), { code });
      assert.equal(calls(), 1, code);
    }
  });

  it("If reading is stopped during a pause it should end as cancelled without asking again", async () => {
    const { sample, calls } = failingThen(["upstream_error"]);
    const stop = new AbortController();
    const asked = withRetries(sample, [60_000]).json("q", { signal: stop.signal });
    stop.abort();
    await assert.rejects(asked, { code: "cancelled" });
    assert.equal(calls(), 1);
  });
});

describe("pause", () => {
  it("If the signal has already aborted it should reject as cancelled at once", async () => {
    await assert.rejects(pause(60_000, AbortSignal.abort()), { code: "cancelled" });
  });
});

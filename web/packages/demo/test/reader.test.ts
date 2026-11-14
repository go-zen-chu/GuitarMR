/**
 * How a reading is split into requests. Every request is billed on the API,
 * so the number of requests and images per page is a contract (ADR-012).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { GtsDocument, Measure } from "@guitarmr/gts";
import { type ReadLayer, type ReaderHost, type Sample, TAB_SYSTEMS_PER_REQUEST, readPages } from "../src/reader.ts";

/** A layout-only document: `perPage[page]` systems of `measuresPerSystem` measures each. */
function layoutDoc(perPage: number[], measuresPerSystem = 4): GtsDocument {
  const all: Measure[] = [];
  perPage.forEach((systems, page) => {
    for (let s = 0; s < systems; s++) {
      const [y0, y1] = [0.1 + 0.1 * s, 0.18 + 0.1 * s];
      for (let i = 0; i < measuresPerSystem; i++) {
        const x = 0.05 + (0.9 * i) / measuresPerSystem;
        all.push({ id: `m${all.length + 1}`, region: { page, bbox: [x, y0, x + 0.9 / measuresPerSystem, y1] } });
      }
    }
  });
  return {
    format: "gts",
    version: "0.1",
    meta: { title: "t", layers: ["layout"] },
    source: {
      file: "t.pdf",
      sha256: "0".repeat(64),
      pages: perPage.map((_, index) => ({ index, rotation: 0 })) as GtsDocument["source"]["pages"],
    },
    sections: [{ measures: all }],
  };
}

interface Asked {
  images: number;
  ids: string[];
}

/** A sample keeping each request; it fails the requests numbered in `failures` (from 1) with their code. */
function recordingSample(failures: Record<number, string> = {}, maxCount = 20) {
  const asked: Asked[] = [];
  const sample: Sample = {
    limits: async () => ({ images: { maxCount } }),
    json: async <T>(input: string, options?: { images?: Blob[] }) => {
      asked.push({ images: options?.images?.length ?? 0, ids: [...input.matchAll(/^- Image \d+: measures (.*) \(left to right\)$/gm)].flatMap((l) => l[1]!.split(", ")) });
      const code = failures[asked.length];
      if (code) throw { code, message: code };
      return { measures: [] } as T;
    },
  };
  return { sample, asked };
}

/** A host over `doc` that keeps what was committed. */
function hostOf(doc: GtsDocument) {
  let current = doc;
  const host: ReaderHost = {
    doc: () => current,
    commit: (next) => {
      current = next;
    },
    pageImage: () => ({ blob: new Blob([]), width: 1000, height: 1400 }),
    progress: () => undefined,
    text: { readingPage: () => "", pageUnreadable: (page, code) => `p${page} ${code}` },
  };
  return host;
}

/** One image per system, and the page top first when asked: what the canvas cutter gives. */
const fakeCut = async (_page: unknown, crops: readonly unknown[], header = false) =>
  Array.from({ length: crops.length + (header ? 1 : 0) }, () => new Blob([]));

const read = (sample: Sample, doc: GtsDocument, pages: number[], layer: ReadLayer, signal = new AbortController().signal) =>
  readPages(sample, hostOf(doc), pages, signal, layer, fakeCut);

describe("readPages requests", () => {
  it("If the tab is read it should send one system per request, so a page of tab is never cut off at the token cap", async () => {
    const { sample, asked } = recordingSample();
    await read(sample, layoutDoc([3]), [0], "tab");
    assert.equal(TAB_SYSTEMS_PER_REQUEST, 1);
    assert.deepEqual(asked, [
      { images: 1, ids: ["m1", "m2", "m3", "m4"] },
      { images: 1, ids: ["m5", "m6", "m7", "m8"] },
      { images: 1, ids: ["m9", "m10", "m11", "m12"] },
    ]);
  });

  it("If structure is read it should send one request per page, with the page top only on the first page", async () => {
    const { sample, asked } = recordingSample();
    await read(sample, layoutDoc([2, 3], 1), [0, 1], "structure");
    assert.deepEqual(asked, [
      { images: 3, ids: ["m1", "m2"] },
      { images: 3, ids: ["m3", "m4", "m5"] },
    ]);
  });

  it("If a page has more systems than one request may carry it should split it within the image limit", async () => {
    const { sample, asked } = recordingSample({}, 3);
    await read(sample, layoutDoc([5], 1), [0], "structure");
    assert.deepEqual(
      asked.map((a) => a.images),
      [3, 3],
    );
  });

  it("If one tab request is cut off it should warn about that page and still read the other systems", async () => {
    const { sample, asked } = recordingSample({ 2: "truncated" });
    const result = await read(sample, layoutDoc([3]), [0], "tab");
    assert.equal(asked.length, 3);
    assert.equal(result.error, undefined);
    assert.deepEqual(
      result.warnings.filter((w) => !w.includes("no answer")),
      ["p1 truncated"],
    );
  });

  it("If the key or the balance stops reading it should send no further request", async () => {
    for (const code of ["invalid_api_key", "no_credit", "rate_limited"]) {
      const { sample, asked } = recordingSample({ 1: code });
      const result = await read(sample, layoutDoc([3, 3]), [0, 1], "tab");
      assert.equal(asked.length, 1, code);
      assert.equal(result.error?.code, code);
    }
  });
});

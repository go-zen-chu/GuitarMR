/**
 * End-to-end checks on the public-domain samples in schemas/examples. Only
 * the gts files are committed; each test run regenerates the PDFs from the
 * songs and checks that layoutscan still reproduces the stored layout layer.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { type GtsDocument, measureLength, measures } from "@guitarmr/gts";
import { validate } from "@guitarmr/gts/validate";
import { analyzePage, buildDocument, measureSpans, renderPages, sha256Hex } from "@guitarmr/layoutscan";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { engrave, findJapaneseFont, pixels } from "../src/engrave.ts";
import { EXAMPLES, SAMPLES, generatePdf } from "../src/make-samples.ts";
import { simulateScan } from "../src/scan.ts";

const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, EXAMPLES), "utf8"));
const near = (actual: number, expected: number, tolerance: number, what = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} ${actual} is not within ${tolerance} of ${expected}`);

for (const name of Object.keys(SAMPLES)) {
  describe(`sample ${name}`, () => {
    let pdf: Uint8Array;
    before(async () => {
      pdf = await generatePdf(name);
    });

    it("If it is loaded it should be a valid gts filling every listed layer", () => {
      const doc = load(name);
      assert.deepEqual(validate(doc), { valid: true, errors: [] });
      const layers = doc.meta.layers ?? [];
      for (const layer of ["layout", "structure", "chords", "tab"] as const) assert.ok(layers.includes(layer), layer);
      assert.ok(doc.sections.every((s) => s.label));
      for (const m of measures(doc)) {
        assert.ok(m.region && m.chords?.length && m.beats?.length, m.id ?? "");
        assert.equal("lyrics" in m, layers.includes("lyrics"), m.id ?? "");
      }
    });

    it("If its tab is read every measure should fill 4/4", () => {
      for (const m of measures(load(name))) assert.deepEqual(measureLength(m), [1, 1], m.id ?? "");
    });

    it("If its PDF is regenerated layoutscan should reproduce the layout layer", async () => {
      const expected = load(name);
      const pages = [];
      for await (const [index, image] of renderPages(pdfjs as never, pdf)) {
        const layout = analyzePage(image);
        if (layout.systems.length) pages.push({ index, layout });
      }
      const detected = buildDocument(`${name}.pdf`, await sha256Hex(pdf), pages);
      // The hash is not compared: font rasterization and JPEG encoding may
      // differ slightly between platforms, the detected layout must not.
      assert.deepEqual({ ...detected.source, sha256: "" }, { ...expected.source, sha256: "" });
      const got = detected.sections[0].measures.map((m) => m.region!);
      const want = measures(expected).map((m) => m.region!);
      assert.deepEqual(
        got.map((r) => r.page),
        want.map((r) => r.page),
      );
      got.forEach((r, i) => r.bbox.forEach((v, j) => near(v, want[i]!.bbox[j]!, 0.003, `m${i + 1}`)));
    });

    it("If it is engraved and scanned measures should be found where they were drawn", (t) => {
      const doc = load(name);
      if (!/^[\x00-\x7f]*$/.test(doc.meta.title) && findJapaneseFont() === null) {
        t.skip("no Japanese font to engrave this sample; set GTS_JP_FONT");
        return;
      }
      const sample = SAMPLES[name]!;
      const { pages, truth } = engrave(doc, sample.systemsPerPage);
      pages.forEach((ctx, index) => {
        const [rotation, skew] = sample.scans[index]!;
        const layout = analyzePage(simulateScan(pixels(ctx), rotation, skew));
        assert.equal(layout.rotation, rotation);
        const spans = layout.systems.flatMap((s) => measureSpans(s));
        const drawn = truth.filter((m) => m.page === index);
        assert.equal(spans.length, drawn.length);
        // Deskewing leaves at most a few pixels of error at 2122 px width.
        spans.forEach(([x0, x1], i) => {
          near(x0, drawn[i]!.x0, 12);
          near(x1, drawn[i]!.x1, 12);
        });
      });
    });
  });
}

it("If the Japanese sample is read verses should follow the endings", () => {
  const sung = measures(load("sakura-sakura")).map((m) => [m.volta, (m.lyrics ?? []).map((l) => l.verse).sort()] as const);
  assert.ok(sung.filter(([volta]) => !volta).every(([, verses]) => verses.join() === "1,2"));
  assert.deepEqual(
    sung.filter(([volta]) => volta),
    [
      [[1], [1]],
      [[2], [2]],
    ],
  );
});

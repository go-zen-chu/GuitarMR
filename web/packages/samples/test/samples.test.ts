/**
 * End-to-end checks on the public-domain samples in schemas/examples. Only
 * the gts files are committed; each test run regenerates the PDFs from the
 * songs and checks that layoutscan still reproduces the stored layout layer.
 */

import { readFileSync } from "node:fs";
import { type GtsDocument, measureLength, measures, validate } from "@guitarmr/gts";
import { analyzePage, buildDocument, measureSpans, renderPages, sha256Hex } from "@guitarmr/layoutscan";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { beforeAll, describe, expect, it } from "vitest";
import { engrave, findJapaneseFont, pixels } from "../src/engrave.ts";
import { EXAMPLES, SAMPLES, generatePdf } from "../src/make-samples.ts";
import { simulateScan } from "../src/scan.ts";

const names = Object.keys(SAMPLES);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, EXAMPLES), "utf8"));

describe.each(names)("sample %s", (name) => {
  let pdf: Uint8Array;
  beforeAll(async () => {
    pdf = await generatePdf(name);
  });

  it("If it is loaded it should be a valid gts filling every listed layer", () => {
    const doc = load(name);
    expect(validate(doc)).toEqual({ valid: true, errors: [] });
    const layers = doc.meta.layers ?? [];
    expect(layers).toEqual(expect.arrayContaining(["layout", "structure", "chords", "tab"]));
    expect(doc.sections.every((s) => s.label)).toBe(true);
    for (const m of measures(doc)) {
      expect(m.region && m.chords?.length && m.beats?.length, m.id).toBeTruthy();
      expect("lyrics" in m, m.id).toBe(layers.includes("lyrics"));
    }
  });

  it("If its tab is read every measure should fill 4/4", () => {
    for (const m of measures(load(name))) expect(measureLength(m), m.id).toEqual([1, 1]);
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
    expect({ ...detected.source, sha256: "" }).toEqual({ ...expected.source, sha256: "" });
    const got = detected.sections[0].measures.map((m) => m.region!);
    const want = measures(expected).map((m) => m.region!);
    expect(got.map((r) => r.page)).toEqual(want.map((r) => r.page));
    got.forEach((r, i) => r.bbox.forEach((v, j) => expect(Math.abs(v - want[i]!.bbox[j]!)).toBeLessThanOrEqual(0.003)));
  });

  it("If it is engraved and scanned measures should be found where they were drawn", (context) => {
    const doc = load(name);
    if (!/^[\x00-\x7f]*$/.test(doc.meta.title) && findJapaneseFont() === null) {
      context.skip("no Japanese font to engrave this sample; set GTS_JP_FONT");
    }
    const sample = SAMPLES[name]!;
    const { pages, truth } = engrave(doc, sample.systemsPerPage);
    pages.forEach((ctx, index) => {
      const [rotation, skew] = sample.scans[index]!;
      const layout = analyzePage(simulateScan(pixels(ctx), rotation, skew));
      expect(layout.rotation).toBe(rotation);
      const spans = layout.systems.flatMap((s) => measureSpans(s));
      const drawn = truth.filter((t) => t.page === index);
      expect(spans).toHaveLength(drawn.length);
      // Deskewing leaves at most a few pixels of error at 2122 px width.
      spans.forEach(([x0, x1], i) => {
        expect(Math.abs(x0 - drawn[i]!.x0)).toBeLessThanOrEqual(12);
        expect(Math.abs(x1 - drawn[i]!.x1)).toBeLessThanOrEqual(12);
      });
    });
  });
});

it("If the Japanese sample is read verses should follow the endings", () => {
  const sung = measures(load("sakura-sakura")).map((m) => [m.volta, (m.lyrics ?? []).map((l) => l.verse).sort()] as const);
  expect(sung.filter(([volta]) => !volta).every(([, verses]) => verses.join() === "1,2")).toBe(true);
  expect(sung.filter(([volta]) => volta)).toEqual([
    [[1], [1]],
    [[2], [2]],
  ]);
});

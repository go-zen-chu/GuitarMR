/**
 * Regenerate the public-domain samples in schemas/examples/: engrave each
 * song, simulate a scan, write the PDF, then run layoutscan on that PDF and
 * store the detected layout layer and PDF hash in the gts file. Only the
 * gts files are committed; the PDFs are regenerated on demand.
 *
 *   pnpm --filter @guitarmr/samples make-samples [name ...]
 */

import { writeFileSync } from "node:fs";
import { validate, type GtsDocument, type Measure } from "@guitarmr/gts";
import { type ScannedPage, analyzePage, buildDocument, renderPages, sha256Hex } from "@guitarmr/layoutscan";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { type SKRSContext2D } from "@napi-rs/canvas";
import { addJapaneseTeacherNotes, addTeacherNotes, engrave, pixels } from "./engrave.ts";
import { simulateScan, writePdf } from "./scan.ts";
import { sakura, twinkle } from "./songs.ts";

export const EXAMPLES = new URL("../../../../schemas/examples/", import.meta.url);

export interface Sample {
  build: () => GtsDocument;
  /** [counter-clockwise turn on the scanner, skew in degrees] per page */
  scans: [number, number][];
  teacherNotes: (ctx: SKRSContext2D) => void;
  systemsPerPage?: number;
}

export const SAMPLES: Record<string, Sample> = {
  "twinkle-twinkle": { build: twinkle, scans: [[90, 0.4]], teacherNotes: addTeacherNotes },
  "sakura-sakura": {
    build: sakura,
    scans: [
      [0, -0.3],
      [180, 0.5],
    ],
    teacherNotes: addJapaneseTeacherNotes,
    systemsPerPage: 2,
  },
};

export function scanPages(sample: Sample, document: GtsDocument) {
  const { pages } = engrave(document, sample.systemsPerPage);
  if (pages.length !== sample.scans.length) throw new Error(`engraved ${pages.length} pages, scans cover ${sample.scans.length}`);
  return pages.map((ctx, i) => {
    if (i === 0) sample.teacherNotes(ctx);
    const [rotation, skew] = sample.scans[i]!;
    return simulateScan(pixels(ctx), rotation, skew, i);
  });
}

const MEASURE_KEY_ORDER = ["id", "region", "barStart", "barEnd", "repeatTimes", "volta", "chords", "lyrics", "beats"];

/** Store what layoutscan detects on the PDF as the layout layer. */
export async function fillLayout(document: GtsDocument, pdfName: string, pdf: Uint8Array): Promise<GtsDocument> {
  const scanned: ScannedPage[] = [];
  for await (const [index, image] of renderPages(pdfjs as never, pdf)) scanned.push({ index, layout: analyzePage(image) });
  const detected = buildDocument(pdfName, await sha256Hex(pdf), scanned.filter((p) => p.layout.systems.length));
  const regions = detected.sections[0].measures.map((m) => m.region!);
  const measures = document.sections.flatMap((s) => s.measures);
  if (regions.length !== measures.length) {
    throw new Error(`${pdfName}: layoutscan found ${regions.length} measures, the song has ${measures.length}`);
  }
  measures.forEach((measure, i) => {
    const withRegion: Record<string, unknown> = { ...measure, region: regions[i] };
    const unknown = Object.keys(withRegion).filter((k) => !MEASURE_KEY_ORDER.includes(k));
    if (unknown.length) throw new Error(`add ${unknown.join(", ")} to MEASURE_KEY_ORDER`);
    const ordered = Object.fromEntries(MEASURE_KEY_ORDER.filter((k) => k in withRegion).map((k) => [k, withRegion[k]]));
    for (const k of Object.keys(measure)) delete (measure as Record<string, unknown>)[k];
    Object.assign(measure as Measure, ordered);
  });
  document.source = detected.source;
  return document;
}

/** Single-line JSON with a space after "," and ":" (like Python's json.dumps). */
function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

/** JSON with small objects/arrays kept on one line. */
export function compactJson(value: unknown, indent = 0, width = 100): string {
  const flat = inline(value);
  const isContainer = typeof value === "object" && value !== null;
  const empty = isContainer && Object.keys(value).length === 0;
  if (flat.length + indent <= width || !isContainer || empty) return flat;
  const pad = " ".repeat(indent + 2);
  if (Array.isArray(value)) {
    return `[\n${value.map((v) => pad + compactJson(v, indent + 2, width)).join(",\n")}\n${" ".repeat(indent)}]`;
  }
  const items = Object.entries(value).map(([k, v]) => `${pad}${JSON.stringify(k)}: ${compactJson(v, indent + 2, width)}`);
  return `{\n${items.join(",\n")}\n${" ".repeat(indent)}}`;
}

/** The sample's scanned-looking PDF, generated deterministically from its song. */
export async function generatePdf(name: string): Promise<Uint8Array> {
  const sample = SAMPLES[name];
  if (!sample) throw new Error(`unknown sample ${name}; known: ${Object.keys(SAMPLES).join(", ")}`);
  return writePdf(scanPages(sample, sample.build()));
}

/**
 * Write `<name>.pdf` (git-ignored: regenerated on demand, never committed)
 * and `<name>.gts.json` (committed) into schemas/examples.
 */
export async function makeSample(name: string): Promise<void> {
  const document = SAMPLES[name]!.build();
  const pdf = await generatePdf(name);
  writeFileSync(new URL(`${name}.pdf`, EXAMPLES), pdf);
  await fillLayout(document, `${name}.pdf`, pdf);
  const result = validate(document);
  if (!result.valid) throw new Error(`${name}: ${result.errors.join("\n")}`);
  writeFileSync(new URL(`${name}.gts.json`, EXAMPLES), `${compactJson(document)}\n`);
  console.log(`wrote ${name}.pdf and ${name}.gts.json`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2);
  for (const name of names.length ? names : Object.keys(SAMPLES)) await makeSample(name);
}

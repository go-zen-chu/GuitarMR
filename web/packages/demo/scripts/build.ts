/**
 * Build the demo as one self-contained HTML file (dist/layoutscan-demo.html):
 * the layoutscan core and the demo sources with their types stripped, the
 * sample PDFs as base64, and pdf.js from the jsDelivr CDN. No bundler: the
 * sources are concatenated into one scope, so the build drops their import
 * statements and `export` keywords.
 *
 * With --android it builds the page for the Android app instead
 * (dist/android/): a whole document with the app's host script in front and
 * pdf.js next to it, so the app works offline.
 *
 *   pnpm --filter @guitarmr/demo build [--no-samples] [--android]
 */

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";
import { generatePdf } from "@guitarmr/samples";

const src = (path: string) => new URL(path, import.meta.url);
const PDFJS_VERSION: string = JSON.parse(readFileSync(src("../package.json"), "utf8")).devDependencies["pdfjs-dist"];
// The legacy build: the modern one needs very recent JS (e.g. Map.getOrInsertComputed)
// that current iOS Safari and Chrome do not have yet.
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/`;
/** Where the Android page finds pdf.js: next to it, in the app's assets. */
const PDFJS_LOCAL = "./pdfjs/";
export const PDFJS_FILES = ["pdf.min.mjs", "pdf.worker.min.mjs"];

/** The Android app's stand-in for the claude.ai runtime (one function scope, run before the page). */
export const ANDROID_HOST = ["../src/api-sample.ts", "../src/android-host.ts"];

/**
 * Core files in dependency order; each only uses names from earlier ones.
 * They run in the worker and, as globals, under the page script.
 */
export const CORE = [
  "../../gts/src/playback.ts",
  "../../gts/src/tabline.ts",
  "../../gts/src/index.ts",
  "../../layoutscan/src/image.ts",
  "../../layoutscan/src/detect.ts",
  "../../layoutscan/src/gts.ts",
  "../../layoutscan/src/pdf.ts",
  "../../layoutscan/src/photo.ts",
  "../src/preview.ts",
  "../../extract/src/crops.ts",
  "../../extract/src/edit.ts",
  "../../extract/src/prompt.ts",
  "../../extract/src/reading.ts",
  "../../extract/src/checks.ts",
  "../../extract/src/tab.ts",
];

/** The page script (one module): app.ts last, it starts everything. */
export const APP = [
  "../src/score-view.ts",
  "../src/editor.ts",
  "../src/reader.ts",
  "../src/player.ts",
  "../src/library.ts",
  "../src/transfer.ts",
  "../src/photos.ts",
  "../src/app.ts",
];

/** Committed public-domain gts files offered in the play view. */
export const SCORES = [
  { file: "sakura-sakura.gts.json", label: "さくらさくら", note: "歌詞・1番/2番カッコ" },
  { file: "twinkle-twinkle.gts.json", label: "きらきら星", note: "全体をリピート" },
  { file: "sample.gts.json", label: "練習曲", note: "D.S. al Coda・押さえかた" },
];

export const SAMPLES = [
  { file: "sakura-sakura.pdf", label: "さくらさくら", note: "2ページ・2ページ目は上下逆" },
  { file: "twinkle-twinkle.pdf", label: "きらきら星", note: "1ページ・横向きにスキャン" },
];

/** A TypeScript module as plain script text sharing one global scope. */
export function scriptOf(path: string): string {
  const js = stripTypeScriptTypes(readFileSync(src(path), "utf8"));
  return js
    .replace(/^import\s[^;]*?\sfrom\s+"[^"]+";\s*$/gms, (m) => (/from\s+"pdfjs-dist"/.test(m) ? m : ""))
    .replace(/^export \* from\s+"[^"]+";\s*$/gm, "") // re-exports: the files are concatenated anyway
    .replace(/^export (?=(async |const |function|let |class ))/gm, "");
}

export const coreScript = (): string => CORE.map(scriptOf).join("\n");
export const appScript = (): string => APP.map(scriptOf).join("\n");

/** Top-level names declared by a script (all files of a bundle share one scope). */
export function topLevelNames(code: string): string[] {
  return [...code.matchAll(/^(?:async\s+)?(?:function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]!);
}

const inline = (code: string) => code.replaceAll("</script", "<\\/script");

export const androidHostScript = (): string => `(() => {\n${ANDROID_HOST.map(scriptOf).join("\n")}\ninstallAndroidHost();\n})();`;

export type EmbeddedSample = (typeof SAMPLES)[number] & { pdf: string };

/** The sample PDFs, generated and base64-encoded for embedding (none without samples). */
export async function loadSamples(withSamples = true): Promise<EmbeddedSample[]> {
  const samples: EmbeddedSample[] = [];
  if (withSamples) {
    for (const s of SAMPLES) {
      const pdf = await generatePdf(s.file.replace(/\.pdf$/, ""));
      samples.push({ ...s, pdf: Buffer.from(pdf).toString("base64") });
    }
  }
  return samples;
}

/** The page body (what the claude.ai Artifact host wraps), loading pdf.js from `pdfjsBase`. */
export async function build(withSamples = true, pdfjsBase = PDFJS_CDN): Promise<string> {
  return renderPage(await loadSamples(withSamples), pdfjsBase);
}

/** The page body from the current sources with the given samples embedded (the dev server calls it on every change). */
export function renderPage(samples: EmbeddedSample[], pdfjsBase = PDFJS_CDN): string {
  const app = appScript()
    .replace('from "pdfjs-dist"', `from "${pdfjsBase}pdf.min.mjs"`)
    .replace('"@PDFJS_WORKER@"', JSON.stringify(`${pdfjsBase}pdf.worker.min.mjs`));
  const scores = SCORES.map((s) => ({
    ...s,
    gts: JSON.parse(readFileSync(src(`../../../../schemas/examples/${s.file}`), "utf8")),
  }));
  // Placeholders are replaced with functions so `$` in the code stays literal.
  return readFileSync(src("../src/page.html"), "utf8")
    .replace("/*@SAMPLES@*/", () => inline(JSON.stringify(samples)))
    .replace("/*@SCORES@*/", () => inline(JSON.stringify(scores)))
    .replace("/*@CORE@*/", () => inline(coreScript()))
    .replace("/*@WORKER@*/", () => inline(scriptOf("../src/worker.ts")))
    .replace("/*@APP@*/", () => inline(app));
}

/** The page for the Android app: a whole document, the host script first, pdf.js from the app's assets. */
export async function buildAndroid(withSamples = true): Promise<string> {
  const body = await build(withSamples, PDFJS_LOCAL);
  return [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    `<script>${inline(androidHostScript())}</script>`,
    body,
    "</html>",
    "",
  ].join("\n");
}

/** Write the Android page and the pdf.js files it loads into `dir`. */
async function writeAndroid(dir: URL, withSamples: boolean): Promise<string> {
  mkdirSync(new URL("pdfjs/", dir), { recursive: true });
  const pdfjsDir = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/legacy/build/pdf.min.mjs")));
  for (const file of PDFJS_FILES) copyFileSync(`${pdfjsDir}/${file}`, new URL(`pdfjs/${file}`, dir));
  const html = await buildAndroid(withSamples);
  writeFileSync(new URL("index.html", dir), html);
  return html;
}

// Compared as paths: the URL form percent-encodes non-ASCII directory names.
if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const withSamples = !process.argv.includes("--no-samples");
  const android = process.argv.includes("--android");
  const out = android ? src("../dist/android/index.html") : src("../dist/layoutscan-demo.html");
  mkdirSync(new URL(".", out), { recursive: true });
  const html = android ? await writeAndroid(new URL(".", out), withSamples) : await build(withSamples);
  if (!android) writeFileSync(out, html);
  process.stderr.write(`INFO wrote ${fileURLToPath(out)} (${(html.length / 1024).toFixed(0)} KiB)\n`);
}

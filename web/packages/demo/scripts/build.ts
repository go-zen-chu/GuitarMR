/**
 * Build the demo as one self-contained HTML file (dist/layoutscan-demo.html):
 * the layoutscan core and the demo sources with their types stripped, the
 * sample PDFs as base64, and pdf.js from the jsDelivr CDN. No bundler: the
 * sources are concatenated into one scope, so the build drops their import
 * statements and `export` keywords.
 *
 *   pnpm --filter @guitarmr/demo build [--no-samples]
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { generatePdf } from "@guitarmr/samples";

const src = (path: string) => new URL(path, import.meta.url);
const PDFJS_VERSION: string = JSON.parse(readFileSync(src("../package.json"), "utf8")).devDependencies["pdfjs-dist"];
// The legacy build: the modern one needs very recent JS (e.g. Map.getOrInsertComputed)
// that current iOS Safari and Chrome do not have yet.
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/`;

/**
 * Core files in dependency order; each only uses names from earlier ones.
 * They run in the worker and, as globals, under the page script.
 */
export const CORE = [
  "../../gts/src/playback.ts",
  "../../gts/src/index.ts",
  "../../layoutscan/src/image.ts",
  "../../layoutscan/src/detect.ts",
  "../../layoutscan/src/gts.ts",
  "../../layoutscan/src/pdf.ts",
  "../src/preview.ts",
  "../../extract/src/crops.ts",
  "../../extract/src/edit.ts",
  "../../extract/src/prompt.ts",
  "../../extract/src/reading.ts",
];

/** The page script (one module): app.ts last, it starts everything. */
export const APP = ["../src/score-view.ts", "../src/editor.ts", "../src/reader.ts", "../src/player.ts", "../src/app.ts"];

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

export async function build(withSamples = true): Promise<string> {
  const samples: ((typeof SAMPLES)[number] & { pdf: string })[] = [];
  if (withSamples) {
    for (const s of SAMPLES) {
      const pdf = await generatePdf(s.file.replace(/\.pdf$/, ""));
      samples.push({ ...s, pdf: Buffer.from(pdf).toString("base64") });
    }
  }
  const app = appScript()
    .replace('from "pdfjs-dist"', `from "${PDFJS_CDN}pdf.min.mjs"`)
    .replace('"@PDFJS_WORKER@"', JSON.stringify(`${PDFJS_CDN}pdf.worker.min.mjs`));
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = src("../dist/layoutscan-demo.html");
  mkdirSync(new URL(".", out), { recursive: true });
  const html = await build(!process.argv.includes("--no-samples"));
  writeFileSync(out, html);
  process.stderr.write(`INFO wrote ${out.pathname} (${(html.length / 1024).toFixed(0)} KiB)\n`);
}

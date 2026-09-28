#!/usr/bin/env node
/** Command line entry point: PDF in, gts JSON (layout layer) out. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { analyzePage, measureSpans, uprightImage } from "./detect.ts";
import { type ScannedPage, buildDocument } from "./gts.ts";
import { drawOverlay } from "./overlay.ts";
import { renderPages, sha256Hex } from "./pdf.ts";

const USAGE = `usage: layoutscan <pdf> [-o <out.gts.json>] [--debug-dir <dir>] [-v]

Detect page orientation, systems and measures of a scanned guitar score PDF
and write the layout layer of a gts file (default: <name>.gts.json next to
the PDF). --debug-dir writes one overlay image per page: systems in blue,
measure regions in red. Pages without staff systems are skipped with a
warning; if no page has any, nothing is written and the exit code is 1.`;

const log = (level: string, message: string) => process.stderr.write(`${level} ${message}\n`);

export async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        "debug-dir": { type: "string" },
        verbose: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (e) {
    log("ERROR", (e as Error).message);
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help || positionals.length !== 1) {
    process.stderr.write(`${USAGE}\n`);
    return values.help ? 0 : 2;
  }
  const pdfPath = positionals[0]!;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(pdfPath));
  } catch {
    log("ERROR", `input not found: ${pdfPath}`);
    return 2;
  }
  const name = basename(pdfPath);
  const output = values.output ?? join(dirname(pdfPath), name.replace(/\.pdf$/i, "") + ".gts.json");
  const debugDir = values["debug-dir"];
  if (debugDir) mkdirSync(debugDir, { recursive: true });

  const scanned: ScannedPage[] = [];
  for await (const [index, image] of renderPages(pdfjs as never, bytes)) {
    const layout = analyzePage(image);
    if (layout.systems.length === 0) {
      log("WARNING", `page index ${index}: no staff systems found, skipped`);
      continue;
    }
    const counts = layout.systems.map((s) => measureSpans(s).length);
    log(
      "INFO",
      `page index ${index}: rotation ${layout.rotation}, skew ${layout.skew.toFixed(2)} deg, ` +
        `${layout.systems.length} systems, ${counts.reduce((a, b) => a + b, 0)} measures [${counts.join(", ")}]`,
    );
    if (values.verbose) {
      layout.systems.forEach((s, i) =>
        log("DEBUG", `page index ${index} system ${i + 1}: ${s.staff ? "staff + TAB" : "TAB only"}, bar lines at x=[${s.barlines.join(", ")}]`),
      );
    }
    scanned.push({ index, layout });
    if (debugDir) {
      const upright = uprightImage(image, layout);
      const canvas = createCanvas(upright.width, upright.height);
      const ctx = canvas.getContext("2d");
      const pixels = ctx.createImageData(upright.width, upright.height);
      pixels.data.set(upright.data);
      ctx.putImageData(pixels, 0, 0);
      drawOverlay(ctx, layout);
      const stem = name.replace(/\.pdf$/i, "");
      writeFileSync(join(debugDir, `${stem}_p${index}.jpg`), await canvas.encode("jpeg", 85));
    }
  }

  if (scanned.length === 0) {
    log("ERROR", `no page with staff systems in ${pdfPath}; nothing written`);
    return 1;
  }
  const document = buildDocument(name, await sha256Hex(bytes), scanned);
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`);
  log("INFO", `wrote ${output} (${scanned.length} pages, ${document.sections[0].measures.length} measures)`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}

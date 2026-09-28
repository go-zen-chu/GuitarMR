import { readFileSync } from "node:fs";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { analyzePage, buildDocument, measureSpans, renderPages, sha256Hex } from "../src/index.ts";

for (const name of process.argv.slice(2)) {
  const bytes = new Uint8Array(readFileSync(name));
  const pages = [];
  for await (const [index, image] of renderPages(pdfjs as never, bytes)) {
    const t = Date.now();
    const layout = analyzePage(image);
    console.log(name.split("/").pop(), "page", index, "rot", layout.rotation, "skew", layout.skew,
      "measures", layout.systems.map((s) => measureSpans(s).length), `${Date.now() - t}ms`);
    if (layout.systems.length) pages.push({ index, layout });
  }
  const doc = buildDocument(name.split("/").pop()!, await sha256Hex(bytes), pages);
  const expectedPath = name.replace(/\.pdf$/, ".gts.json");
  try {
    const expected = JSON.parse(readFileSync(expectedPath, "utf8"));
    const got = doc.sections[0].measures.map((m) => m.region!.bbox);
    const want = expected.sections.flatMap((s: { measures: { region: { bbox: number[] } }[] }) => s.measures.map((m) => m.region.bbox));
    const maxDiff = Math.max(...got.flatMap((b, i) => b.map((v, j) => Math.abs(v - (want[i]?.[j] ?? 9)))));
    console.log("  count", got.length, "vs", want.length, "max bbox diff", maxDiff.toFixed(4), "sha match", doc.source.sha256 === expected.source.sha256);
  } catch {}
}

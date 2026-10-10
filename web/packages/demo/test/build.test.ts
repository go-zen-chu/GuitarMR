/** The single-file build: the concatenated core must behave like the modules. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { analyzePage } from "@guitarmr/layoutscan";
import { engrave, pixels, twinkle } from "@guitarmr/samples";
import { appScript, build, coreScript, scriptOf, topLevelNames } from "../scripts/build.ts";

describe("demo build", () => {
  it("If the sources are concatenated no import or export should remain", () => {
    for (const code of [coreScript(), scriptOf("../src/worker.ts")]) {
      assert.doesNotMatch(code, /^\s*(import|export)\s/m);
    }
    // The page script keeps only its pdf.js import.
    assert.deepEqual(appScript().match(/^\s*import\s.*$/gm)?.length, 1);
    assert.doesNotMatch(appScript(), /^\s*export\s/m);
  });

  it("If files share one scope no top-level name should be declared twice", () => {
    for (const names of [topLevelNames(coreScript()), [...topLevelNames(coreScript()), ...topLevelNames(appScript())]]) {
      const seen = new Set<string>();
      const twice = names.filter((n) => seen.size === seen.add(n).size);
      assert.deepEqual(twice, []);
    }
    assert.ok(topLevelNames(coreScript()).includes("analyzePage"));
  });

  it("If the bundled core runs in a fresh scope it should detect like the modules", () => {
    const image = pixels(engrave(twinkle()).pages[0]!);
    // One function scope, as in the worker (a vm context would be far slower).
    const result = new Function("image", `${coreScript()}\nreturn detect({ index: 0, image });`)(image) as {
      layout: unknown;
      preview: { width: number; height: number };
    };
    assert.deepEqual(JSON.parse(JSON.stringify(result.layout)), JSON.parse(JSON.stringify(analyzePage(image))));
    assert.equal(Math.max(result.preview.width, result.preview.height), 2400);
  });

  it("If the page is built it should load pdf.js from the pinned CDN version only", async () => {
    const html = await build(false);
    const urls = [...html.matchAll(/https:\/\/[^"'\s)]+/g)].map((m) => m[0]);
    for (const url of urls) assert.match(url, /^https:\/\/(cdn\.jsdelivr\.net\/npm\/pdfjs-dist@\d+\.\d+\.\d+\/legacy\/build\/|fonts\.(googleapis|gstatic)\.com)/);
    assert.ok(urls.some((u) => u.endsWith("pdf.worker.min.mjs")));
    assert.doesNotMatch(html, /\/\*@[A-Z]+@\*\/|@PDFJS_WORKER@/);
  });
});

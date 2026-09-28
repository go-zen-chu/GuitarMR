/** The layoutscan CLI end to end, on PDFs written by the sample tools. */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import { validate } from "@guitarmr/gts/validate";
import { main } from "@guitarmr/layoutscan/cli";
import { engrave, pixels } from "../src/engrave.ts";
import { writePdf } from "../src/scan.ts";
import { twinkle } from "../src/songs.ts";

function blankPage() {
  const ctx = createCanvas(2122, 3000).getContext("2d");
  ctx.fillStyle = "rgb(248,246,244)";
  ctx.fillRect(0, 0, 2122, 3000);
  ctx.fillStyle = "rgb(60,60,60)";
  ctx.font = "60px sans-serif";
  ctx.fillText("Lyrics only, no staves", 300, 600);
  return { width: 2122, height: 3000, data: ctx.getImageData(0, 0, 2122, 3000).data };
}

describe("layoutscan CLI", () => {
  it("If no page has systems it should fail without writing", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "layoutscan-"));
    writeFileSync(join(dir, "lyrics.pdf"), await writePdf([blankPage()]));
    t.mock.method(process.stderr, "write", () => true);

    assert.equal(await main([join(dir, "lyrics.pdf")]), 1);
    assert.equal(existsSync(join(dir, "lyrics.gts.json")), false);
  });

  it("If some pages have no systems it should skip and report them", async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "layoutscan-"));
    const score = pixels(engrave(twinkle()).pages[0]!);
    writeFileSync(join(dir, "song.pdf"), await writePdf([blankPage(), score]));
    const lines: string[] = [];
    t.mock.method(process.stderr, "write", (s: unknown) => (lines.push(String(s)), true));

    assert.equal(await main([join(dir, "song.pdf"), "--debug-dir", join(dir, "debug")]), 0);

    const doc = JSON.parse(readFileSync(join(dir, "song.gts.json"), "utf8"));
    assert.equal(validate(doc).valid, true);
    assert.deepEqual(doc.source.pages, [{ index: 1, rotation: 0 }]);
    assert.equal(doc.sections[0].measures.length, 12);
    assert.match(lines.join(""), /page index 0: no staff systems found, skipped/);
    assert.ok(existsSync(join(dir, "debug", "song_p1.jpg")));
  });

  it("If the input does not exist it should exit with a usage error", async (t) => {
    t.mock.method(process.stderr, "write", () => true);
    assert.equal(await main(["/nonexistent/score.pdf"]), 2);
  });
});

/** The layoutscan CLI end to end, on PDFs written by the sample tools. */

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { validate } from "@guitarmr/gts";
import { main } from "@guitarmr/layoutscan/cli";
import { describe, expect, it, vi } from "vitest";
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
  it("If no page has systems it should fail without writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "layoutscan-"));
    writeFileSync(join(dir, "lyrics.pdf"), await writePdf([blankPage()]));
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    expect(await main([join(dir, "lyrics.pdf")])).toBe(1);

    stderr.mockRestore();
    expect(existsSync(join(dir, "lyrics.gts.json"))).toBe(false);
  });

  it("If some pages have no systems it should skip and report them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "layoutscan-"));
    const score = pixels(engrave(twinkle()).pages[0]!);
    writeFileSync(join(dir, "song.pdf"), await writePdf([blankPage(), score]));
    const lines: string[] = [];
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation((s) => (lines.push(String(s)), true));

    expect(await main([join(dir, "song.pdf"), "--debug-dir", join(dir, "debug")])).toBe(0);

    stderr.mockRestore();
    const doc = JSON.parse(readFileSync(join(dir, "song.gts.json"), "utf8"));
    expect(validate(doc).valid).toBe(true);
    expect(doc.source.pages).toEqual([{ index: 1, rotation: 0 }]);
    expect(doc.sections[0].measures).toHaveLength(12);
    expect(lines.join("")).toContain("page index 0: no staff systems found, skipped");
    expect(existsSync(join(dir, "debug", "song_p1.jpg"))).toBe(true);
  });

  it("If the input does not exist it should exit with a usage error", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    expect(await main(["/nonexistent/score.pdf"])).toBe(2);
    stderr.mockRestore();
  });
});

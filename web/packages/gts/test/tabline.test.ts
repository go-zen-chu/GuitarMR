import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type Beat, type GtsDocument, formatTabLine, measures, parseTabLine } from "../src/index.ts";

const load = (name: string): GtsDocument =>
  JSON.parse(readFileSync(new URL(`../../../../schemas/examples/${name}.gts.json`, import.meta.url), "utf8"));

describe("tab line", () => {
  it("If the samples' beats are written as tab lines they should read back the same", () => {
    for (const name of ["sample", "sakura-sakura", "twinkle-twinkle"]) {
      for (const m of measures(load(name))) {
        const line = formatTabLine(m.beats);
        assert.deepEqual(parseTabLine(line), { beats: m.beats ?? [], invalid: [] }, `${name} ${m.id}: ${line}`);
      }
    }
  });

  it("If a line uses every mark it should be read into the matching fields", () => {
    const { beats, invalid } = parseTabLine("8.:~6-0h+5-(2)b1.5vm!d 16t5:1-x*l> 4..:r!f 2:/!u");
    assert.deepEqual(invalid, []);
    assert.deepEqual(beats, [
      {
        duration: { value: 8, dots: 1 },
        stroke: "down",
        notes: [
          { string: 6, fret: 0, tie: true, slur: "hammer-on" },
          { string: 5, fret: 2, ghost: true, bend: 1.5, vibrato: true, palmMute: true },
        ],
      },
      { duration: { value: 16, tuplet: [5, 4] }, notes: [{ string: 1, dead: true, harmonic: "natural", letRing: true, accent: true }] },
      { duration: { value: 4, dots: 2 }, rest: true, fermata: true },
      { duration: { value: 2 }, slash: true, stroke: "up" },
    ] as Beat[]);
    assert.equal(formatTabLine(beats), "8.:~6-0h+5-(2)b1.5vm!d 16t5:1-x*l> 4..:r!f 2:/!u");
  });

  it("If a token is not a beat it should be reported and the rest kept", () => {
    const { beats, invalid } = parseTabLine("4:7-0 3:1-0 4:1-25 4:1-0!x 4:2-3 4");
    assert.deepEqual(beats, [{ duration: { value: 4 }, notes: [{ string: 2, fret: 3 }] }]);
    assert.equal(invalid.length, 5);
    assert.match(invalid[2]!, /0〜24/);
  });

  it("If a beat is unchanged by an edit its fingering should be kept", () => {
    const previous = [
      { duration: { value: 4 }, notes: [{ string: 2, fret: 1, finger: "1" }], brush: "arpeggio-up" },
      { duration: { value: 4 }, notes: [{ string: 3, fret: 2, finger: "2" }] },
    ] as Beat[];
    const { beats } = parseTabLine("4:2-1 4:3-4", previous);
    assert.deepEqual(beats[0], previous[0]);
    assert.deepEqual(beats[1], { duration: { value: 4 }, notes: [{ string: 3, fret: 4 }] });
  });
});

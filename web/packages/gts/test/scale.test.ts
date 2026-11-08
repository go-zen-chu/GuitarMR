import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  type GtsDocument,
  type Measure,
  fitScales,
  noteNamesIn,
  parseKey,
  parseTabLine,
  playOrder,
  sameNoteScales,
  scaleStepName,
  songKey,
  songScale,
} from "../src/index.ts";

const examples = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, examples), "utf8"));

/** A one-section 4/4 score of these measures. */
function score(measures: Measure[], meta: Partial<GtsDocument["meta"]> = {}): GtsDocument {
  return {
    format: "gts",
    version: "0.1",
    meta: { title: "t", timeSignature: "4/4", ...meta },
    source: { file: "t.pdf", pages: [{ index: 0, rotation: 0 }] },
    sections: [{ measures: measures as [Measure, ...Measure[]] }],
  } as GtsDocument;
}
const scaleOf = (doc: GtsDocument) => {
  const steps = playOrder(doc);
  return songScale(doc, steps, songKey(doc, steps)!)!;
};
/** Weights with one beat on each of these pitch classes. */
const weightsOf = (...pcs: number[]) => Array.from({ length: 12 }, (_, pc) => (pcs.includes(pc) ? 1 : 0));

describe("fitScales", () => {
  it("If a melody uses five notes it should take the pentatonic scale over the seven-note ones", () => {
    assert.equal(fitScales(weightsOf(0, 2, 4, 7, 9), 0)[0]!.scale.id, "major-pentatonic");
    assert.equal(fitScales(weightsOf(0, 4, 5, 7, 11), 0)[0]!.scale.id, "ryukyu");
    assert.equal(fitScales(weightsOf(0, 1, 5, 7, 8), 0)[0]!.scale.id, "miyako-bushi");
    assert.equal(fitScales(weightsOf(0, 2, 4, 5, 7, 9, 11), 0)[0]!.scale.id, "major");
  });

  it("If a few passing notes fall outside it should still fit, and else take the closest", () => {
    const weights = weightsOf(0, 2, 4, 7, 9).map((w) => w * 30);
    weights[5] = 1;
    assert.equal(fitScales(weights, 0)[0]!.scale.id, "major-pentatonic");
    const best = fitScales(weightsOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11), 0)[0]!;
    assert.ok(best.coverage < 0.95 && best.scale.intervals.length === 7);
  });
});

describe("songScale", () => {
  it("If the tab has a melody it should count its single notes, relative to the capo", () => {
    // C major pentatonic as written, played with a capo on 2 (frets as written).
    const doc = score([{ beats: parseTabLine("8:5-3 8:4-0 8:4-2 8:3-0 8:3-2 8:5-3").beats }], { key: "C", capo: 2 });
    const scale = scaleOf(doc);
    assert.equal(scale.from, "melody");
    assert.equal(scale.main.scale.id, "major-pentatonic");
    assert.equal(scale.main.tonic, 0);
  });

  it("If the score has only chords it should count their tones", () => {
    const doc = score([{ chords: [{ symbol: "C" }, { symbol: "F", beat: 3 }] }, { chords: [{ symbol: "G7" }] }], { key: "C" });
    const scale = scaleOf(doc);
    assert.equal(scale.from, "chords");
    assert.equal(scale.main.scale.id, "major");
  });

  it("If the sample songs are analysed it should find their scales, listing others that agree with the key", () => {
    const sakura = scaleOf(load("sakura-sakura"));
    assert.equal(sakura.main.scale.id, "yona-nuki-minor");
    assert.deepEqual(sakura.others.map((f) => f.scale.id), ["natural-minor", "harmonic-minor"]);
    assert.equal(scaleOf(load("twinkle-twinkle")).main.scale.id, "major");
    // G major: the melodic minor holds these notes too but is not offered in a major key.
    assert.deepEqual(scaleOf(load("sample")).others, []);
  });
});

describe("sameNoteScales / names", () => {
  it("If a scale is given it should name the scales on other tonics with the same notes", () => {
    const [sakura] = fitScales(weightsOf(9, 11, 0, 4, 5), 9);
    assert.deepEqual(sameNoteScales(sakura!).map((f) => [f.scale.id, f.tonic]), [["miyako-bushi", 4]]);
    const [major] = fitScales(weightsOf(0, 2, 4, 5, 7, 9, 11), 0);
    assert.deepEqual(sameNoteScales(major!).map((f) => [f.scale.id, f.tonic]), [["natural-minor", 9]]);
  });

  it("If notes are named they should follow the key's sharps or flats", () => {
    assert.equal(noteNamesIn(parseKey("D")!)[6], "F♯");
    assert.equal(noteNamesIn(parseKey("F")!)[10], "B♭");
    assert.equal(noteNamesIn(parseKey("Em")!)[6], "F♯");
    assert.deepEqual([0, 3, 6, 10].map(scaleStepName), ["1", "♭3", "♯4", "♭7"]);
  });
});

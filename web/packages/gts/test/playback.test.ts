import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type GtsDocument, lyricsFor, playOrder, soundingChords } from "../src/index.ts";

const examples = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, examples), "utf8"));
const ids = (doc: GtsDocument) => playOrder(doc).map((s) => s.measure.id);
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => `m${a + i}`);

describe("playOrder", () => {
  it("If the whole song is repeated it should be played twice", () => {
    const steps = playOrder(load("twinkle-twinkle"));
    assert.deepEqual(steps.map((s) => s.measure.id), [...range(1, 12), ...range(1, 12)]);
    assert.deepEqual([steps[0]!.pass, steps[12]!.pass], [1, 2]);
    assert.deepEqual([steps[0]!.section, steps[4]!.section, steps[13]!.section], ["A", "B", undefined]);
  });

  it("If a repeat has 1st and 2nd endings each pass should take its own", () => {
    assert.deepEqual(ids(load("sakura-sakura")), [...range(1, 14), ...range(1, 13), "m15"]);
  });

  it("If the score has D.S. al Coda it should jump to the segno and then to the coda", () => {
    const steps = playOrder(load("sample"));
    assert.deepEqual(
      steps.map((s) => s.measure.id),
      ["m1", "m2", "m1", "m3", "m4", "m5", "m6", "m7", "m4", "m5", "m6", "m8"],
    );
    // After the 2nd ending the song is past the repeat: back to pass 1.
    assert.deepEqual(
      steps.map((s) => s.pass),
      [1, 1, 2, 2, 1, 1, 1, 1, 1, 1, 1, 1],
    );
  });

  it("If steps are timed they should follow the time signatures", () => {
    const doc = load("twinkle-twinkle");
    doc.sections[0]!.measures[1]!.timeSignature = "3/4";
    const steps = playOrder(doc);
    assert.deepEqual(
      steps.slice(0, 4).map((s) => [s.beats, s.start]),
      [
        [4, 0],
        [3, 4],
        [3, 7],
        [3, 10],
      ],
    );
  });

  it("If D.C. al Fine is written it should stop at Fine without repeats", () => {
    const doc = load("twinkle-twinkle");
    const m = doc.sections.flatMap((s) => s.measures);
    m[3]!.navigation = ["fine"];
    m[11]!.navigation = ["dc"];
    // First time through: repeat taken (m1..m12 twice), then D.C. to m1, stop at m4.
    assert.deepEqual(ids(doc), [...range(1, 12), ...range(1, 12), ...range(1, 4)]);
  });

  it("If a jump has no target the expansion should still end", () => {
    const doc = load("twinkle-twinkle");
    for (const m of doc.sections.flatMap((s) => s.measures)) m.navigation = ["ds"];
    assert.ok(playOrder(doc).length < 100);
  });
});

describe("soundingChords and lyrics", () => {
  it("If a measure writes no chord it should show the carried or repeated one", () => {
    const steps = playOrder(load("sample"));
    const chords = soundingChords(steps);
    // m5 is a simile measure without chords: it repeats m4's G.
    assert.deepEqual(chords[5], { chords: [{ symbol: "G" }], carried: false });
    const doc = load("twinkle-twinkle");
    delete doc.sections[0]!.measures[1]!.chords;
    assert.deepEqual(soundingChords(playOrder(doc))[1], { chords: [{ symbol: "C", beat: 1 }], carried: true });
  });

  it("If a verse is sung on the second pass the second verse should be shown", () => {
    const steps = playOrder(load("sakura-sakura"));
    // m3 is sung "やよいの" on the first pass and "のやまも" on the second.
    assert.deepEqual([steps[2]!.measure.id, steps[16]!.measure.id], ["m3", "m3"]);
    const first = lyricsFor(steps[2]!);
    const second = lyricsFor(steps[16]!);
    assert.ok(first && second && first !== second, `${first} / ${second}`);
  });
});

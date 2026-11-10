import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  type GtsDocument,
  type Key,
  type Measure,
  degreeName,
  estimateKey,
  parseChord,
  parseKey,
  playOrder,
  progressions,
  songKey,
} from "../src/index.ts";

const examples = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, examples), "utf8"));

/** A one-section 4/4 score with one measure per chord line ("Am E7"). */
function score(lines: string[], meta: Partial<GtsDocument["meta"]> = {}): GtsDocument {
  const measures: Measure[] = lines.map((line) => ({ chords: line.split(" ").map((symbol) => ({ symbol })) }));
  return {
    format: "gts",
    version: "0.1",
    meta: { title: "t", timeSignature: "4/4", ...meta },
    source: { file: "t.pdf", pages: [{ index: 0, rotation: 0 }] },
    sections: [{ measures: measures as [Measure, ...Measure[]] }],
  } as GtsDocument;
}
const key = (name: string): Key => parseKey(name)!;
const found = (doc: GtsDocument) => {
  const steps = playOrder(doc);
  return progressions(steps, songKey(doc, steps)!);
};
const ids = (doc: GtsDocument) => found(doc).map((p) => p.id);

describe("parseChord / parseKey", () => {
  it("If chord names are given it should tell their root, bass and kind", () => {
    const cases: [string, [number, number, string]][] = [
      ["C", [0, 0, "major"]],
      ["F#m7", [6, 6, "minor"]],
      ["G7", [7, 7, "dominant"]],
      ["Bm7-5", [11, 11, "half-diminished"]],
      ["Bbdim", [10, 10, "diminished"]],
      ["Dsus4", [2, 2, "suspended"]],
      ["E7sus4", [4, 4, "suspended"]],
      ["FM7", [5, 5, "major"]],
      ["Caug", [0, 0, "augmented"]],
      ["Am/G", [9, 7, "minor"]],
    ];
    for (const [symbol, [root, bass, kind]] of cases) {
      assert.deepEqual(parseChord(symbol), { root, bass, quality: parseChord(symbol)!.quality, kind }, symbol);
    }
    assert.equal(parseChord("N.C."), null);
  });

  it("If keys are written in the usual ways it should read them, and refuse others", () => {
    assert.deepEqual(parseKey("Am"), { tonic: 9, minor: true, name: "Am", estimated: false });
    assert.deepEqual(parseKey("F#m"), { tonic: 6, minor: true, name: "F#m", estimated: false });
    assert.deepEqual(parseKey("Bb"), { tonic: 10, minor: false, name: "Bb", estimated: false });
    assert.equal(parseKey("C minor")!.minor, true);
    assert.equal(parseKey("CM")!.minor, false);
    assert.equal(parseKey("H"), null);
    assert.equal(parseKey("cm"), null);
  });
});

describe("degreeName", () => {
  it("If chords are named in a key it should give their degrees, keeping the quality and the bass", () => {
    const inC = ["C", "Dm7", "Em", "FM7", "G7", "Am", "Bm7-5", "Bb", "E7", "C/E"].map((s) => degreeName(s, key("C")));
    assert.deepEqual(inC, ["Ⅰ", "Ⅱm7", "Ⅲm", "ⅣM7", "Ⅴ7", "Ⅵm", "Ⅶm7-5", "♭Ⅶ", "Ⅲ7", "Ⅰ/Ⅲ"]);
    const inAm = ["Am", "Am/G", "Dm7", "FM7", "E7sus4", "C", "Bm7b5"].map((s) => degreeName(s, key("Am")));
    assert.deepEqual(inAm, ["Ⅰm", "Ⅰm/♭Ⅶ", "Ⅳm7", "♭ⅥM7", "Ⅴ7sus4", "♭Ⅲ", "Ⅱm7♭5"]);
    assert.equal(degreeName("N.C.", key("C")), null);
  });
});

describe("estimateKey / songKey", () => {
  it("If the score writes its key it should use it", () => {
    const doc = score(["C", "G7"], { key: "Am" });
    assert.deepEqual(songKey(doc, playOrder(doc)), { tonic: 9, minor: true, name: "Am", estimated: false });
  });

  it("If the score writes no key it should guess it from the chords, the ending on the tonic deciding", () => {
    const guess = (lines: string[]) => {
      const doc = score(lines);
      return songKey(doc, playOrder(doc))!;
    };
    assert.deepEqual(guess(["G", "Em", "C D7", "G"]), { tonic: 7, minor: false, name: "G", estimated: true });
    assert.equal(guess(["Am", "Dm", "E7", "Am"]).name, "Am");
    assert.equal(guess(["F", "Bb", "C7", "F"]).name, "F");
    assert.equal(estimateKey([]), null);
  });
});

describe("progressions", () => {
  it("If a song has a Ⅱ→Ⅴ→Ⅰ it should list it, and not its Ⅴ→Ⅰ again", () => {
    const list = found(score(["C", "Dm7 G7", "C"], { key: "C" }));
    assert.deepEqual(list.map((p) => p.id), ["two-five-one"]);
    assert.deepEqual(list[0]!.occurrences, [
      {
        steps: [1, 2],
        start: { step: 1, chord: 0 },
        end: { step: 2, chord: 0 },
        chords: ["Dm7", "G7", "C"],
        degrees: ["Ⅱm7", "Ⅴ7", "Ⅰ"],
      },
    ]);
  });

  it("If the J-pop progressions are played they should be named, in a minor key too", () => {
    assert.deepEqual(ids(score(["FM7 G7", "Em7 Am"], { key: "C" })), ["royal-road"]);
    assert.ok(ids(score(["Am F", "G C"], { key: "C" })).includes("komuro"));
    // In A minor the relative major C is Ⅰ: Am F G C is still Ⅵm→Ⅳ→Ⅴ→Ⅰ.
    assert.ok(ids(score(["Am F", "G C"], { key: "Am" })).includes("komuro"));
    assert.ok(ids(score(["C G", "Am Em", "F C", "F G"], { key: "C" })).includes("canon"));
  });

  it("If a 7th leads to a chord other than Ⅰ it should be a secondary dominant", () => {
    const list = found(score(["C", "E7", "Am"], { key: "C" }));
    assert.deepEqual(list.map((p) => p.id), ["secondary-dominant"]);
    assert.deepEqual(list[0]!.occurrences[0]!.degrees, ["Ⅲ7", "Ⅵm"]);
  });

  it("If a sus4 resolves on its root it should be listed, even inside another progression", () => {
    const list = found(score(["Am Dm", "Esus4 E", "Am"], { key: "Am" }));
    assert.deepEqual(list.map((p) => p.id), ["cadence", "sus4"]);
    // The harmony on E is reached as Esus4 and leaves as E.
    assert.deepEqual(list[0]!.occurrences[0]!.chords, ["Dm", "E", "Am"]);
  });

  it("If a N.C. stands between two chords it should break the progression", () => {
    assert.deepEqual(ids(score(["G7", "N.C.", "C"], { key: "C" })), []);
  });

  it("If a progression is played again by a repeat it should be counted once, at its first time", () => {
    const doc = score(["C", "G7", "C"], { key: "C" });
    doc.sections[0].measures[0]!.barStart = "repeat-start";
    doc.sections[0].measures[2]!.barEnd = "repeat-end";
    const motion = found(doc).find((p) => p.id === "dominant-motion")!;
    assert.deepEqual(motion.occurrences.map((o) => o.steps), [[1, 2]]);
  });

  it("If the sample songs are analysed it should find their typical moves", () => {
    const sakura = load("sakura-sakura");
    const ofSakura = found(sakura);
    assert.deepEqual(ofSakura.map((p) => p.id), ["two-five-one", "cadence", "dominant-motion", "two-five", "sus4"]);
    // The 2nd ending stops on the Ⅴ: the same Ⅱ→Ⅴ, not resolved this time.
    assert.deepEqual(ofSakura[3]!.occurrences[0]!.chords, ["Bm7-5", "E7"]);
    assert.deepEqual(ofSakura[0]!.occurrences[0]!.degrees, ["Ⅱm7-5", "Ⅴ7", "Ⅰm"]);
    // From the Bm7-5 on beat 3 of measure 13 to the Am that the repeat comes back to.
    assert.deepEqual(ofSakura[0]!.occurrences[0]!.start, { step: 12, chord: 2 });
    assert.equal(sakura.sections.flatMap((x) => x.measures)[playOrder(sakura)[ofSakura[0]!.occurrences[0]!.end.step]!.index]!.chords![0]!.symbol, "Am");
    assert.deepEqual(ids(load("twinkle-twinkle")), ["dominant-motion", "plagal"]);
    assert.deepEqual(ids(load("sample")), ["komuro", "sus4"]);
  });
});

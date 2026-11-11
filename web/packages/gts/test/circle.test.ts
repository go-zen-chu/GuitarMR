import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  CIRCLE_OF_FIFTHS,
  type DiatonicChord,
  type GtsDocument,
  type Key,
  chordName,
  degreeName,
  diatonicChords,
  parseKey,
  playOrder,
  playsChord,
  relatedKeys,
  songChords,
} from "../src/index.ts";

const examples = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, examples), "utf8"));
const key = (name: string): Key => parseKey(name)!;
const names = (k: Key) => diatonicChords(k).map((d) => chordName(d.chord, k));
/** The substitutes of the diatonic chord on `step`, as "name kind". */
const substitutes = (k: Key, step: number) =>
  diatonicChords(k)
    .find((d: DiatonicChord) => d.chord.step === step)!
    .substitutes.map((s) => `${chordName(s.chord, k)} ${s.kind}`);

describe("CIRCLE_OF_FIFTHS", () => {
  it("If the circle is walked it should step a fifth each time and hold every pitch once", () => {
    CIRCLE_OF_FIFTHS.forEach((pc, i) => assert.equal(CIRCLE_OF_FIFTHS[(i + 1) % 12], (pc + 7) % 12));
    assert.equal(new Set(CIRCLE_OF_FIFTHS).size, 12);
  });
});

describe("diatonicChords / chordName", () => {
  it("If a major key is given it should list its 7th chords with their functions", () => {
    assert.deepEqual(names(key("C")), ["CM7", "Dm7", "Em7", "FM7", "G7", "Am7", "Bm7-5"]);
    assert.deepEqual(
      diatonicChords(key("C")).map((d) => d.chord.function),
      ["tonic", "subdominant", "tonic", "subdominant", "dominant", "tonic", "dominant"],
    );
  });

  it("If a minor key is given it should list the natural minor's 7th chords", () => {
    assert.deepEqual(names(key("Am")), ["Am7", "Bm7-5", "CM7", "Dm7", "Em7", "FM7", "G7"]);
  });

  it("If a key is written with sharps or flats it should spell each root on its own letter", () => {
    assert.deepEqual(names(key("E")), ["EM7", "F#m7", "G#m7", "AM7", "B7", "C#m7", "D#m7-5"]);
    assert.deepEqual(names(key("Bb")), ["BbM7", "Cm7", "Dm7", "EbM7", "F7", "Gm7", "Am7-5"]);
    assert.deepEqual(names(key("F#m")), ["F#m7", "G#m7-5", "AM7", "Bm7", "C#m7", "DM7", "E7"]);
  });

  it("If a borrowed chord is spelled in a sharp key it should take a flat on its own letter", () => {
    assert.deepEqual(substitutes(key("G"), 4), ["Am7 same-function", "Am7-5 borrowed", "Cm7 borrowed", "EbM7 borrowed", "F7 borrowed"]);
  });

  it("If chord names are made it should read back as the same degrees", () => {
    for (const k of [key("C"), key("Am"), key("Eb"), key("C#m")]) {
      const degrees = names(k).map((n) => degreeName(n, k));
      assert.deepEqual(degrees, k.minor ? ["Ⅰm7", "Ⅱm7-5", "♭ⅢM7", "Ⅳm7", "Ⅴm7", "♭ⅥM7", "♭Ⅶ7"] : ["ⅠM7", "Ⅱm7", "Ⅲm7", "ⅣM7", "Ⅴ7", "Ⅵm7", "Ⅶm7-5"]);
    }
  });
});

describe("diatonicChords substitutes", () => {
  it("If a major key's tonic is given it should be replaced by the other tonic chords", () => {
    assert.deepEqual(substitutes(key("C"), 1), ["Em7 same-function", "Am7 same-function"]);
  });

  it("If a major key's dominant is given it should offer Ⅶm7-5 and the tritone substitute", () => {
    assert.deepEqual(substitutes(key("C"), 5), ["Bm7-5 same-function", "Db7 tritone"]);
    assert.deepEqual(substitutes(key("C"), 7), ["G7 same-function"]);
  });

  it("If a major key's subdominant is given it should offer the subdominant minors of the parallel key", () => {
    assert.deepEqual(substitutes(key("C"), 2), ["FM7 same-function", "Dm7-5 borrowed", "Fm7 borrowed", "AbM7 borrowed", "Bb7 borrowed"]);
  });

  it("If a minor key's Ⅴm7 is given it should offer the harmonic minor's dominants and the tritone substitute", () => {
    assert.deepEqual(substitutes(key("Am"), 5), ["E7 harmonic-minor", "G#dim7 harmonic-minor", "Bb7 tritone"]);
  });

  it("If a minor key's subdominant is given it should offer the parallel major's Ⅱm7 and ⅣM7", () => {
    assert.deepEqual(substitutes(key("Am"), 4), ["Bm7-5 same-function", "FM7 same-function", "G7 same-function", "Bm7 borrowed", "DM7 borrowed"]);
  });
});

describe("relatedKeys", () => {
  it("If a key is given it should name its neighbors on the circle, its relative and its parallel key", () => {
    const names = (k: Key) => Object.values(relatedKeys(k)).map((r) => r.name);
    assert.deepEqual(names(key("C")), ["G", "F", "Am", "Cm"]);
    assert.deepEqual(names(key("Am")), ["Em", "Dm", "C", "A"]);
  });
});

describe("songChords / playsChord", () => {
  it("If a song plays a triad or another voicing of a key's chord it should count as played", () => {
    const am = key("Am");
    const played = songChords(playOrder(load("sakura-sakura")));
    // Am, Bm7-5, C, Dm, FM7 and E7; neither Em nor G.
    assert.deepEqual(
      diatonicChords(am).map((d) => playsChord(played, d.chord, am)),
      [true, true, true, true, false, true, false],
    );
    const e7 = diatonicChords(am)[4]!.substitutes.find((s) => s.kind === "harmonic-minor")!;
    assert.equal(playsChord(played, e7.chord, am), true);
  });
});

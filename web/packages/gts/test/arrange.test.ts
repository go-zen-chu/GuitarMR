import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type FretNote,
  type ScaleFit,
  type SoundingChords,
  SCALES,
  STANDARD_TUNING,
  chordTones,
  keyScaleFit,
  parseChord,
  parseKey,
  safeFrets,
  soundingChordAt,
} from "../src/index.ts";

/** The scale of this id on this tonic. */
const fitOf = (id: string, tonic: number): ScaleFit => ({ scale: SCALES.find((s) => s.id === id)!, tonic, coverage: 1 });
/** The frets of one string, as "fret:role" ("3:chord-tone"). */
const onString = (notes: readonly FretNote[], string: number) =>
  notes.filter((n) => n.string === string).map((n) => `${n.fret}:${n.role}${n.tonic ? "*" : ""}`);
/** Sounding chords of one measure each, from "symbol@beat" lists. */
const measures = (...lines: string[][]): SoundingChords[] =>
  lines.map((line) => ({
    carried: false,
    chords: line.map((c) => {
      const [symbol, beat] = c.split("@");
      return { symbol: symbol!, beat: Number(beat ?? 1) };
    }),
  }));

describe("chordTones", () => {
  it("If a slash chord is given it should hold its tones and its bass", () => {
    assert.deepEqual([...chordTones(parseChord("E7")!)].sort((a, b) => a - b), [2, 4, 8, 11]);
    assert.deepEqual([...chordTones(parseChord("Am/G")!)].sort((a, b) => a - b), [0, 4, 7, 9]);
  });
});

describe("safeFrets", () => {
  it("If a chord sounds it should mark its tones as the safest and the rest of the scale as usable", () => {
    const notes = safeFrets(fitOf("minor-pentatonic", 9), parseChord("Am")!, STANDARD_TUNING, 5);
    // String 1 (E): E chord tone, G scale, A chord tone (tonic); F, F♯, G♯ are left out.
    assert.deepEqual(onString(notes, 1), ["0:chord-tone", "3:scale", "5:chord-tone*"]);
    assert.deepEqual(onString(notes, 6), ["0:chord-tone", "3:scale", "5:chord-tone*"]);
  });

  it("If a chord tone is outside the scale it should still be marked as a chord tone", () => {
    const notes = safeFrets(fitOf("yona-nuki-minor", 9), parseChord("E7")!, STANDARD_TUNING, 4);
    // String 3 (G): G♯ (1) and B (4) are E7's; A (2) and C (5, outside the range) only the scale's.
    assert.deepEqual(onString(notes, 3), ["1:chord-tone", "2:scale*", "4:chord-tone"]);
  });

  it("If no chord sounds it should mark only the scale's notes", () => {
    const notes = safeFrets(keyScaleFit(parseKey("C")!), null, STANDARD_TUNING, 12);
    assert.ok(notes.every((n) => n.role === "scale"));
    // Seven notes over 13 frets: 7 or 8 a string.
    assert.ok(notes.length >= 42 && notes.length <= 48, String(notes.length));
  });
});

describe("soundingChordAt", () => {
  it("If a beat is given it should take the last chord written by then", () => {
    const sounding = measures(["Am", "E7@3"], ["F@1"]);
    assert.deepEqual(soundingChordAt(sounding, 0, 1), { step: 0, chord: 0 });
    assert.deepEqual(soundingChordAt(sounding, 0, 3.5), { step: 0, chord: 1 });
    assert.deepEqual(soundingChordAt(sounding, 1, 2), { step: 1, chord: 0 });
  });

  it("If a measure's first chord comes later it should keep the one sounding from before", () => {
    const sounding = measures(["Am", "E7@3"], ["F@3"], []);
    assert.deepEqual(soundingChordAt(sounding, 1, 1), { step: 0, chord: 1 });
    assert.deepEqual(soundingChordAt(sounding, 2, 1), { step: 1, chord: 0 });
  });

  it("If the song has not played a chord yet it should be null", () => {
    assert.equal(soundingChordAt(measures([], ["Am@3"]), 1, 2), null);
  });
});

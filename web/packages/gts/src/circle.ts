/**
 * The key on the circle of fifths: its diatonic chords (the chords made of
 * the key's scale) with what each does (tonic, subdominant, dominant), the
 * chords that can stand in for each one (代理コード), and the keys next to
 * it. Chords are the four-note (7th) chords, spelled from the key's tonic
 * letter. Pure functions, shared by the phone viewer and (later) the
 * Quest app.
 */

import { type ChordKind, type Key, type ParsedChord, keyName, parseChord } from "./harmony.ts";
import { type PlayStep, soundingChords } from "./playback.ts";
import { PITCH_CLASS } from "./sound.ts";
import { noteNamesIn } from "./scale.ts";

/** Pitch classes clockwise from C, a fifth apart. */
export const CIRCLE_OF_FIFTHS: readonly number[] = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

export type ChordFunction = "tonic" | "subdominant" | "dominant";

/** A chord of a key, by where its root lies from the tonic. */
export interface KeyChord {
  /** Scale step of the root, 1 to 7: the letter it is spelled with. */
  step: number;
  /** Semitones of the root above the tonic. */
  interval: number;
  /** What follows the root, e.g. "M7", "m7-5". */
  quality: string;
  function: ChordFunction;
}

/**
 * How a chord stands in for a diatonic one: another diatonic chord with the
 * same function, the tritone substitute of a dominant 7th (裏コード), a
 * subdominant borrowed from the parallel key, or the dominants of the
 * harmonic minor in a minor key.
 */
export type SubstituteKind = "same-function" | "tritone" | "borrowed" | "harmonic-minor";

export interface Substitute {
  chord: KeyChord;
  kind: SubstituteKind;
}

export interface DiatonicChord {
  chord: KeyChord;
  substitutes: Substitute[];
}

const keyChord = (step: number, interval: number, quality: string, fn: ChordFunction): KeyChord => ({
  step,
  interval,
  quality,
  function: fn,
});

/** The diatonic 7th chords of the major and the natural minor scale. */
const DIATONIC_SEVENTHS: Record<"major" | "minor", readonly KeyChord[]> = {
  major: [
    keyChord(1, 0, "M7", "tonic"),
    keyChord(2, 2, "m7", "subdominant"),
    keyChord(3, 4, "m7", "tonic"),
    keyChord(4, 5, "M7", "subdominant"),
    keyChord(5, 7, "7", "dominant"),
    keyChord(6, 9, "m7", "tonic"),
    keyChord(7, 11, "m7-5", "dominant"),
  ],
  minor: [
    keyChord(1, 0, "m7", "tonic"),
    keyChord(2, 2, "m7-5", "subdominant"),
    keyChord(3, 3, "M7", "tonic"),
    keyChord(4, 5, "m7", "subdominant"),
    keyChord(5, 7, "m7", "dominant"),
    keyChord(6, 8, "M7", "subdominant"),
    keyChord(7, 10, "7", "subdominant"),
  ],
};

/** The dominants of the harmonic minor, which give a minor key its leading tone. */
const HARMONIC_MINOR_DOMINANTS: readonly KeyChord[] = [keyChord(5, 7, "7", "dominant"), keyChord(7, 11, "dim7", "dominant")];

const sameChord = (a: KeyChord, b: KeyChord) => a.interval === b.interval && a.quality === b.quality;

/** The 7th chord a tritone away, which shares the dominant's 3rd and 7th (G7 → D♭7). */
const tritoneOf = (dominant: KeyChord): KeyChord =>
  keyChord(((dominant.step + 3) % 7) + 1, (dominant.interval + 6) % 12, "7", "dominant");

/** The chords that can stand in for `chord` in a key of this mode. */
function substitutesOf(chord: KeyChord, minor: boolean): Substitute[] {
  const own = DIATONIC_SEVENTHS[minor ? "minor" : "major"];
  const out: Substitute[] = own
    .filter((c) => c.function === chord.function && !sameChord(c, chord))
    .map((c) => ({ chord: c, kind: "same-function" }));
  const dominants = chord.function === "dominant" && minor ? HARMONIC_MINOR_DOMINANTS : [];
  for (const c of dominants) out.push({ chord: c, kind: "harmonic-minor" });
  for (const c of [chord, ...dominants]) {
    if (c.function === "dominant" && c.quality === "7") out.push({ chord: tritoneOf(c), kind: "tritone" });
  }
  if (chord.function === "subdominant") {
    for (const c of DIATONIC_SEVENTHS[minor ? "major" : "minor"]) {
      if (c.function === "subdominant" && !own.some((o) => sameChord(o, c))) out.push({ chord: c, kind: "borrowed" });
    }
  }
  return out;
}

/** The diatonic chords of a key, Ⅰ to Ⅶ, each with the chords that can stand in for it. */
export function diatonicChords(key: Key): DiatonicChord[] {
  return DIATONIC_SEVENTHS[key.minor ? "minor" : "major"].map((chord) => ({ chord, substitutes: substitutesOf(chord, key.minor) }));
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTALS: Record<number, string> = { 0: "", 1: "#", 11: "b" };

/**
 * A chord of the key by name, its root spelled on the letter of its step
 * (♭Ⅵ of G is Eb, not D#). A root that would need a double accidental takes
 * the plain name of its pitch instead.
 */
export function chordName(chord: KeyChord, key: Key): string {
  const tonicLetter = LETTERS.indexOf(noteNamesIn(key)[key.tonic]![0]!);
  const letter = LETTERS[(tonicLetter + chord.step - 1) % 7]!;
  const root = (key.tonic + chord.interval) % 12;
  const accidental = ACCIDENTALS[(root - PITCH_CLASS[letter]! + 12) % 12];
  const spelled = accidental === undefined ? noteNamesIn(key)[root]!.replace("♯", "#").replace("♭", "b") : `${letter}${accidental}`;
  return `${spelled}${chord.quality}`;
}

export interface RelatedKeys {
  /** A fifth above, the next key clockwise (属調). */
  dominant: Key;
  /** A fifth below, the next key counterclockwise (下属調). */
  subdominant: Key;
  /** Same notes, the other mode (平行調). */
  relative: Key;
  /** Same tonic, the other mode (同主調). */
  parallel: Key;
}

/** The keys closest to `key`: its neighbors on the circle, and the two that share its notes or its tonic. */
export function relatedKeys(key: Key): RelatedKeys {
  const make = (tonic: number, minor: boolean): Key => ({ tonic: tonic % 12, minor, name: keyName(tonic, minor), estimated: false });
  return {
    dominant: make(key.tonic + 7, key.minor),
    subdominant: make(key.tonic + 5, key.minor),
    relative: key.minor ? make(key.tonic + 3, false) : make(key.tonic + 9, true),
    parallel: make(key.tonic, !key.minor),
  };
}

/** Chords heard alike in a key: the same root and the same third (C, CM7 and Csus4 are all "C"). */
function thirdOf(kind: ChordKind): "major" | "minor" | "diminished" {
  if (kind === "minor") return "minor";
  return kind === "diminished" || kind === "half-diminished" ? "diminished" : "major";
}

/** The chords a song plays, each kind once. */
export function songChords(steps: readonly PlayStep[]): ParsedChord[] {
  const seen = new Map<string, ParsedChord>();
  for (const { chords } of soundingChords(steps)) {
    for (const c of chords) {
      const parsed = parseChord(c.symbol);
      if (parsed) seen.set(`${parsed.root}:${thirdOf(parsed.kind)}`, parsed);
    }
  }
  return [...seen.values()];
}

/** Whether the song plays `chord` of the key, as a triad, a 7th or any other voicing on the same root and third. */
export function playsChord(played: readonly ParsedChord[], chord: KeyChord, key: Key): boolean {
  const wanted = parseChord(chordName(chord, key))!;
  return played.some((p) => p.root === wanted.root && thirdOf(p.kind) === thirdOf(wanted.kind));
}

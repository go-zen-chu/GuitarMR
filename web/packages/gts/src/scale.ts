/**
 * The scale a song is made of: the notes its melody uses (the tab's single
 * notes; the chord tones when there is no melody), matched against
 * scales on the key's tonic, from the major scale to the Okinawan and
 * the Japanese ones. Pitches are counted relative to the capo, like the
 * chord names and the key. Pure functions, shared by the phone viewer and
 * (later) the Quest app.
 */

import type { GuitarTabScoreGts as GtsDocument } from "./types.generated.ts";
import { type PlayStep, soundingChords } from "./playback.ts";
import { chordIntervals, soundEvents } from "./sound.ts";
import { type Key, parseChord } from "./harmony.ts";

export interface Scale {
  /** Which scale ("major", "ryukyu", ...); the viewer names and explains it. */
  id: string;
  /** Semitones above the tonic, ascending from 0. */
  intervals: readonly number[];
}

/** Scales looked for, most common first (the first of equal fit is taken). */
export const SCALES: readonly Scale[] = [
  { id: "major", intervals: [0, 2, 4, 5, 7, 9, 11] },
  { id: "natural-minor", intervals: [0, 2, 3, 5, 7, 8, 10] },
  { id: "major-pentatonic", intervals: [0, 2, 4, 7, 9] },
  { id: "minor-pentatonic", intervals: [0, 3, 5, 7, 10] },
  { id: "yona-nuki-minor", intervals: [0, 2, 3, 7, 8] },
  { id: "miyako-bushi", intervals: [0, 1, 5, 7, 8] },
  { id: "ryukyu", intervals: [0, 4, 5, 7, 11] },
  { id: "ritsu", intervals: [0, 2, 5, 7, 9] },
  { id: "blues", intervals: [0, 3, 5, 6, 7, 10] },
  { id: "harmonic-minor", intervals: [0, 2, 3, 5, 7, 8, 11] },
  { id: "melodic-minor", intervals: [0, 2, 3, 5, 7, 9, 11] },
  { id: "dorian", intervals: [0, 2, 3, 5, 7, 9, 10] },
  { id: "mixolydian", intervals: [0, 2, 4, 5, 7, 9, 10] },
  { id: "lydian", intervals: [0, 2, 4, 6, 7, 9, 11] },
  { id: "phrygian", intervals: [0, 1, 3, 5, 7, 8, 10] },
];

/** Share of the notes (by length) a scale must hold to fit; the rest are passing notes. */
const FIT = 0.95;
/** Other fitting scales listed at most. */
const MAX_OTHERS = 3;
/** Church modes: every major scale holds them all, so naming them as "the same notes" says nothing. */
const MODES = new Set(["dorian", "mixolydian", "lydian", "phrygian"]);

export interface ScaleFit {
  scale: Scale;
  /** Pitch class of the scale's first note, 0 = C. */
  tonic: number;
  /** Share of the song's notes, by length, that are in the scale. */
  coverage: number;
}

export interface SongScale {
  /** The scale that fits with the fewest notes. */
  main: ScaleFit;
  /** Other scales on the tonic that fit too and agree with the key on its third, fewest notes first. */
  others: ScaleFit[];
  /** What was counted: the melody, or the chords when the tab has no melody. */
  from: "melody" | "chords";
  /** How long each pitch class sounds, in beats (index 0 = C). */
  weights: number[];
}

/** Beats each pitch class sounds: the tab's single notes, or the chord tones when there are none. */
function noteWeights(document: GtsDocument, steps: readonly PlayStep[]): { weights: number[]; from: SongScale["from"] } {
  const capo = document.meta.capo ?? 0;
  const melody = new Array<number>(12).fill(0);
  for (const e of soundEvents(document, steps)) {
    if (e.part === "tab" && !e.muted && e.notes.length === 1) melody[(((e.notes[0]! - capo) % 12) + 12) % 12]! += e.length;
  }
  if (melody.some((w) => w > 0)) return { weights: melody, from: "melody" };
  const chords = new Array<number>(12).fill(0);
  soundingChords(steps).forEach(({ chords: sounding }, k) => {
    sounding.forEach((c, j) => {
      const parsed = parseChord(c.symbol);
      if (!parsed) return;
      const length = (sounding[j + 1]?.beat ?? steps[k]!.beats + 1) - (c.beat ?? 1);
      for (const i of chordIntervals(parsed.quality)) chords[(parsed.root + i) % 12]! += length;
    });
  });
  return { weights: chords, from: "chords" };
}

/** How the scales on `tonic` fit `weights`, the best fitting first. */
export function fitScales(weights: readonly number[], tonic: number): ScaleFit[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const fits = SCALES.map((scale) => {
    const inside = scale.intervals.reduce((sum, i) => sum + weights[(tonic + i) % 12]!, 0);
    return { scale, tonic, coverage: total ? inside / total : 0 };
  });
  // Fitting scales with fewer notes say more (a melody of five notes is pentatonic, not "major").
  const rank = (f: ScaleFit) => (f.coverage >= FIT ? f.scale.intervals.length : 100 - f.coverage);
  return fits.sort((a, b) => rank(a) - rank(b));
}

/** The scale of a song in `key`; null when it has neither melody nor chords. */
export function songScale(document: GtsDocument, steps: readonly PlayStep[], key: Key): SongScale | null {
  const { weights, from } = noteWeights(document, steps);
  if (!weights.some((w) => w > 0)) return null;
  const [main, ...rest] = fitScales(weights, key.tonic);
  const third = key.minor ? 3 : 4;
  const agrees = (f: ScaleFit) => f.scale.intervals.includes(third) || !f.scale.intervals.includes(7 - third);
  const others = rest.filter((f) => f.coverage >= FIT && agrees(f)).slice(0, MAX_OTHERS);
  return { main: main!, others, from, weights };
}

/** The key's own scale: the major scale, or the natural minor. */
export function keyScaleFit(key: Key): ScaleFit {
  return { scale: SCALES.find((s) => s.id === (key.minor ? "natural-minor" : "major"))!, tonic: key.tonic, coverage: 1 };
}

/** Named scales on other tonics made of exactly the same notes (A 平調子 = E 都節音階, C major = A natural minor). */
export function sameNoteScales(fit: ScaleFit): ScaleFit[] {
  const notes = (f: { tonic: number; intervals: readonly number[] }) =>
    f.intervals.map((i) => (f.tonic + i) % 12).sort((a, b) => a - b).join(",");
  const own = notes({ tonic: fit.tonic, intervals: fit.scale.intervals });
  const out: ScaleFit[] = [];
  for (const scale of SCALES) {
    if (MODES.has(scale.id)) continue;
    for (let tonic = 0; tonic < 12; tonic++) {
      if (tonic === fit.tonic) continue;
      if (notes({ tonic, intervals: scale.intervals }) === own) out.push({ scale, tonic, coverage: fit.coverage });
    }
  }
  return out;
}

/** Degree names of scale notes after the major scale: 1, ♭3, ♯4 ... */
const STEP_NAMES = ["1", "♭2", "2", "♭3", "3", "4", "♯4", "5", "♭6", "6", "♭7", "7"];

/** "♭3" for 3 semitones above the tonic. */
export function scaleStepName(interval: number): string {
  return STEP_NAMES[((interval % 12) + 12) % 12]!;
}

const SHARP_NAMES = ["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"];
const FLAT_NAMES = ["C", "D♭", "D", "E♭", "E", "F", "G♭", "G", "A♭", "A", "B♭", "B"];
/** Major keys written with sharps (by tonic pitch class): C G D A E B F♯. */
const SHARP_MAJOR_KEYS = new Set([0, 7, 2, 9, 4, 11, 6]);

/** Note names as the key spells them: sharps in sharp keys, flats in flat keys. */
export function noteNamesIn(key: Key): string[] {
  const major = key.minor ? (key.tonic + 3) % 12 : key.tonic;
  return SHARP_MAJOR_KEYS.has(major) ? SHARP_NAMES : FLAT_NAMES;
}

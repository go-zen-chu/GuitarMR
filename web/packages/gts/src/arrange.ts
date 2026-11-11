/**
 * Arranging inside the harmony: where on the neck the notes lie that stay
 * in the song's scale, and which of them are the sounding chord's tones,
 * the safest to play over it. Frets count from the capo and pitches are
 * capo-relative, like the chord names and the key. Pure functions, shared
 * by the phone viewer and (later) the Quest app.
 */

import type { SoundingChords } from "./playback.ts";
import type { ParsedChord } from "./harmony.ts";
import { chordIntervals } from "./sound.ts";
import type { ScaleFit } from "./scale.ts";

/** How safe a note is over the sounding chord: one of its tones, or only in the scale. */
export type NoteRole = "chord-tone" | "scale";

export interface FretNote {
  /** String 1 (the highest) to 6. */
  string: number;
  /** Fret from the open string (or the capo). */
  fret: number;
  role: NoteRole;
  /** True on the scale's first note. */
  tonic: boolean;
}

/** Pitch classes of a chord: its tones from the root, and the bass of a slash chord. */
export function chordTones(chord: ParsedChord): Set<number> {
  const tones = new Set(chordIntervals(chord.quality).map((i) => (chord.root + i) % 12));
  tones.add(chord.bass);
  return tones;
}

/**
 * The notes to play on frets 0 to `frets` of each string over `chord` (null
 * when none sounds): the chord's tones, and the other notes of the scale.
 * A chord tone outside the scale (the G♯ of E7 in A minor) still counts.
 */
export function safeFrets(fit: ScaleFit, chord: ParsedChord | null, tuning: readonly number[], frets: number): FretNote[] {
  const inScale = new Set(fit.scale.intervals.map((i) => (fit.tonic + i) % 12));
  const tones = chord ? chordTones(chord) : new Set<number>();
  const out: FretNote[] = [];
  tuning.slice(0, 6).forEach((open, s) => {
    for (let fret = 0; fret <= frets; fret++) {
      const pc = (((open + fret) % 12) + 12) % 12;
      const role: NoteRole | null = tones.has(pc) ? "chord-tone" : inScale.has(pc) ? "scale" : null;
      if (role) out.push({ string: s + 1, fret, role, tonic: pc === fit.tonic });
    }
  });
  return out;
}

/** A chord in the play order: the step, and which of its sounding chords. */
export interface SoundingPlace {
  step: number;
  chord: number;
}

/**
 * The chord sounding `beat` beats into step `step` (1 = its first beat): the
 * last one written by then, else the one still sounding from the steps
 * before. Null before the song's first chord.
 */
export function soundingChordAt(sounding: readonly SoundingChords[], step: number, beat: number): SoundingPlace | null {
  for (let k = step; k >= 0; k--) {
    const chords = sounding[k]?.chords ?? [];
    let index = -1;
    chords.forEach((c, i) => {
      if (k < step || (c.beat ?? 1) <= beat) index = i;
    });
    if (index >= 0) return { step: k, chord: index };
  }
  return null;
}

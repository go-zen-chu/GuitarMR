/**
 * What a score sounds like, as timed notes for a synthesizer: the chord
 * names strummed where they change (and again at each measure they carry
 * over), and the tab layer note by note, its slashes strumming the chord
 * sounding at that point. Pitches follow the tuning and the capo, since
 * chord names and frets are written relative to the capo. Pure functions
 * over the play order, shared by the phone viewer and (later) the Quest app.
 */

import type { GuitarTabScoreGts as GtsDocument, ChordShape } from "./types.generated.ts";
import { type PlayStep, soundingChords } from "./playback.ts";
import { beatLength } from "./index.ts";

/** Open strings from string 1 (high E) to 6 (low E) as MIDI note numbers. */
export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40];

export interface SoundEvent {
  /** Which layer it comes from: the chord names or the tab. */
  part: "chord" | "tab";
  /** Beat position from the start of the song, as PlayStep.start. */
  at: number;
  /** How long it rings, in beats. */
  length: number;
  /** MIDI note numbers, low to high. */
  notes: number[];
  /** Strum direction: a down stroke plays the low string first. */
  stroke?: "down" | "up";
  /** Dead ("x") notes: a short percussive scratch instead of a pitch. */
  muted?: boolean;
}

const PITCH_CLASS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "E4", "Bb3", "F#2" → MIDI number (C4 = 60); null when unreadable. */
export function midiOf(name: string): number | null {
  const m = /^([A-G])([#b♯♭]?)(-?\d)$/.exec(name.trim());
  if (!m) return null;
  const accidental = m[2] === "#" || m[2] === "♯" ? 1 : m[2] ? -1 : 0;
  return (Number(m[3]) + 1) * 12 + PITCH_CLASS[m[1]!]! + accidental;
}

/** The open strings of a score (string 1 first), falling back to standard tuning. */
export function tuningOf(document: GtsDocument): number[] {
  const written = (document.meta.tuning ?? []).map(midiOf);
  return written.length === 6 && written.every((n) => n !== null) ? (written as number[]) : STANDARD_TUNING;
}

/** Semitones above the root for a chord quality such as "m7-5", "sus4", "add9" (a major triad when unknown). */
export function chordIntervals(quality: string): number[] {
  let q = quality.replace(/[()]/g, "");
  let third = 4;
  let fifth = 7;
  let seventh: number | null = null;
  const extra = new Set<number>();
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(q);
    if (m) q = q.slice(m[0].length);
    return m;
  };
  if (take(/^(m7-5|m7b5|ø7?)/)) {
    third = 3;
    fifth = 6;
    seventh = 10;
  } else if (take(/^(dim|°|o)/)) {
    third = 3;
    fifth = 6;
    if (take(/^7/)) seventh = 9;
  } else if (take(/^(aug|\+)(?!\d)/)) {
    fifth = 8;
  } else if (take(/^(mM|mmaj|m△|mΔ)/)) {
    third = 3;
    seventh = 11;
    take(/^7/);
  } else if (take(/^(min|m(?!aj))/)) {
    third = 3;
  }
  const major = take(/^(maj|M|△|Δ)/);
  const extension = take(/^(13|11|9|7)/);
  if (major) seventh = 11;
  if (extension) {
    seventh ??= 10;
    const n = Number(extension[1]);
    if (n >= 9) extra.add(14);
    if (n >= 11) extra.add(17);
    if (n >= 13) extra.add(21);
  } else if (take(/^69/)) {
    extra.add(9).add(14);
  } else if (take(/^6/)) {
    extra.add(9);
  }
  while (q) {
    if (take(/^sus2/)) third = 2;
    else if (take(/^sus4?/)) third = 5;
    else if (take(/^add(9|2)/)) extra.add(14);
    else if (take(/^add(11|4)/)) extra.add(17);
    else if (take(/^(-5|b5|♭5)/)) fifth = 6;
    else if (take(/^(\+5|#5|♯5)/)) fifth = 8;
    else if (take(/^(-9|b9|♭9)/)) extra.add(13);
    else if (take(/^(\+9|#9|♯9)/)) extra.add(15);
    else if (take(/^(\+11|#11|♯11)/)) extra.add(18);
    else if (take(/^(-13|b13|♭13)/)) extra.add(20);
    else q = q.slice(1);
  }
  const tones = [0, third, fifth, ...(seventh === null ? [] : [seventh]), ...extra];
  return [...new Set(tones)].sort((a, b) => a - b);
}

/**
 * A guitar-like voicing of a chord name, as written (before the capo): the
 * bass (the root, or the note after "/") between E2 and D♯3, the fifth
 * above it, then the chord tones an octave up. Null for "N.C." and names
 * that are not chords.
 */
export function chordVoicing(symbol: string): number[] | null {
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(symbol);
  if (!m) return null;
  const pitchClass = (letter: string, accidental: string | undefined) =>
    (PITCH_CLASS[letter]! + (accidental === "#" || accidental === "♯" ? 1 : accidental ? -1 : 0) + 12) % 12;
  // E2 (40) is the lowest open string.
  const inBass = (pc: number) => 40 + ((pc - 4 + 12) % 12);
  const root = inBass(pitchClass(m[1]!, m[2]));
  const intervals = chordIntervals(m[3]!);
  const bass = m[4] ? inBass(pitchClass(m[4], m[5])) : root;
  const notes = [bass];
  if (intervals.includes(7) && root + 7 > bass) notes.push(root + 7);
  for (const i of intervals) notes.push(root + 12 + i);
  return [...new Set(notes)].sort((a, b) => a - b);
}

/** A drawn chord shape on the given open strings (string 1 first), low to high. */
export function shapeVoicing(shape: ChordShape, tuning: readonly number[]): number[] {
  return shape.frets
    .flatMap((fret, s) => (typeof fret === "number" && fret >= 0 ? [tuning[s]! + fret] : []))
    .sort((a, b) => a - b);
}

/** Units of the time signature's beat per whole note ("6/8" → 8). */
function beatUnit(timeSignature: string | undefined): number {
  const n = Number(timeSignature?.split("/")[1]);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

/**
 * The sound of the steps of `document` (from playOrder), in time order.
 * Tied notes are left out (the earlier note keeps ringing).
 */
export function soundEvents(document: GtsDocument, steps: readonly PlayStep[]): SoundEvent[] {
  const tuning = tuningOf(document);
  const capo = document.meta.capo ?? 0;
  const shapes = document.chordShapes ?? {};
  const voicing = (chord: { symbol: string; shape?: string }): number[] | null => {
    const shape = chord.shape ? shapes[chord.shape] : undefined;
    const notes = shape ? shapeVoicing(shape, tuning) : chordVoicing(chord.symbol);
    return notes?.length ? notes.map((n) => n + capo) : null;
  };
  const sounding = soundingChords(steps);
  const events: SoundEvent[] = [];
  let timeSignature = document.meta.timeSignature;
  let lastChord: { symbol: string; shape?: string } | undefined;

  steps.forEach((step, k) => {
    if (step.measure.timeSignature) timeSignature = step.measure.timeSignature;
    const unit = beatUnit(timeSignature);
    const { chords } = sounding[k]!;
    const before = lastChord;
    chords.forEach((chord, j) => {
      const beat = chord.beat ?? 1;
      const end = chords[j + 1]?.beat ?? step.beats + 1;
      const notes = voicing(chord);
      if (notes) events.push({ part: "chord", at: step.start + beat - 1, length: end - beat, notes, stroke: "down" });
    });
    if (chords.length) lastChord = chords[chords.length - 1];

    /** The chord sounding at `offset` beats into the measure. */
    const chordAt = (offset: number) => [...chords].reverse().find((c) => (c.beat ?? 1) - 1 <= offset + 1e-6) ?? before;
    const simile = step.measure.simile;
    const beats = step.measure.beats ?? (simile ? steps[k - simile]?.measure.beats : undefined) ?? [];
    let offset = 0;
    for (const beat of beats) {
      const [num, den] = beatLength(beat);
      const length = (num / den) * unit;
      const at = step.start + offset;
      if (beat.slash) {
        const chord = chordAt(offset);
        const notes = chord && voicing(chord);
        if (notes) events.push({ part: "tab", at, length, notes, stroke: beat.stroke ?? "down" });
      } else if (beat.notes?.length) {
        const struck = beat.notes.filter((n) => !n.tie);
        const pitched = struck.filter((n) => !n.dead && typeof n.fret === "number");
        const open = (string: number) => (tuning[string - 1] ?? tuning[0]!) + capo;
        if (pitched.length) {
          events.push({
            part: "tab",
            at,
            length,
            notes: pitched.map((n) => open(n.string) + n.fret!).sort((a, b) => a - b),
            ...(beat.stroke ? { stroke: beat.stroke } : {}),
          });
        } else if (struck.length) {
          events.push({
            part: "tab",
            at,
            length,
            notes: struck.map((n) => open(n.string)).sort((a, b) => a - b),
            muted: true,
            ...(beat.stroke ? { stroke: beat.stroke } : {}),
          });
        }
      }
      offset += length;
    }
  });
  return events.sort((a, b) => a.at - b.at);
}

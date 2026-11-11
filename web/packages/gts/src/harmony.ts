/**
 * What the chords do in the key: each chord name as a degree of the key
 * ("Ⅱm7-5", "♭ⅥM7", "Ⅰm/♭Ⅶ"), and the well-known progressions found in
 * the play order (two-five-one, cadences, the J-pop progressions, sus4
 * resolutions). The key is the one written on the score, else estimated
 * from the chords. Chord names and the key are both capo-relative, so the
 * degrees are the same with or without the capo. Pure functions, shared
 * by the phone viewer and (later) the Quest app.
 */

import type { GuitarTabScoreGts as GtsDocument } from "./types.generated.ts";
import { type PlayStep, soundingChords } from "./playback.ts";
import { PITCH_CLASS, chordIntervals } from "./sound.ts";

export type ChordKind = "major" | "minor" | "dominant" | "suspended" | "diminished" | "half-diminished" | "augmented";

export interface ParsedChord {
  /** Pitch class of the root, 0 = C. */
  root: number;
  /** Pitch class of the bass: the note after "/", else the root. */
  bass: number;
  /** What follows the root as written, e.g. "m7-5", "sus4". */
  quality: string;
  kind: ChordKind;
}

export interface Key {
  /** Pitch class of the tonic, 0 = C. */
  tonic: number;
  minor: boolean;
  /** As written ("Am"), or the estimated key's name. */
  name: string;
  /** True when the score writes no (readable) key and it was guessed from the chords. */
  estimated: boolean;
}

const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
/** Degree names by semitones above the tonic, after the major scale (minor keys too: ♭Ⅲ, ♭Ⅵ, ♭Ⅶ). */
const DEGREE_NAMES = ["Ⅰ", "♭Ⅱ", "Ⅱ", "♭Ⅲ", "Ⅲ", "Ⅳ", "♯Ⅳ", "Ⅴ", "♭Ⅵ", "Ⅵ", "♭Ⅶ", "Ⅶ"];

function pitchClass(letter: string, accidental: string | undefined): number {
  const shift = accidental === "#" || accidental === "♯" ? 1 : accidental ? -1 : 0;
  return (PITCH_CLASS[letter]! + shift + 12) % 12;
}

/** The kind of chord a quality makes, from its chord tones. */
function kindOf(quality: string): ChordKind {
  const tones = new Set(chordIntervals(quality));
  if (!tones.has(3) && !tones.has(4)) return "suspended";
  if (tones.has(3) && tones.has(6)) return tones.has(10) ? "half-diminished" : "diminished";
  if (tones.has(3)) return "minor";
  if (tones.has(8) && !tones.has(7)) return "augmented";
  return tones.has(10) ? "dominant" : "major";
}

/** Root, bass and kind of a chord name; null for "N.C." and names that are not chords. */
export function parseChord(symbol: string): ParsedChord | null {
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(symbol);
  if (!m) return null;
  const root = pitchClass(m[1]!, m[2]);
  return { root, bass: m[4] ? pitchClass(m[4], m[5]) : root, quality: m[3]!, kind: kindOf(m[3]!) };
}

/** A key as written on a score: "G", "Em", "F#m", "Bb minor"; null when unreadable. */
export function parseKey(name: string): Key | null {
  const m = /^\s*([A-G])([#b♯♭]?)\s*(m|min|minor|maj|major)?\s*$/i.exec(name);
  if (!m || !/^[A-G]$/.test(m[1]!)) return null;
  // Case-insensitive except for a lone M, which means major as in chord names ("CM").
  const minor = /^m(in(or)?)?$/i.test(m[3] ?? "") && m[3] !== "M";
  return { tonic: pitchClass(m[1]!, m[2]), minor, name: name.trim(), estimated: false };
}

/** Diatonic chords of a key by semitones above the tonic, with the kinds that fit there. */
const DIATONIC: Record<"major" | "minor", Map<number, ChordKind[]>> = {
  major: new Map([
    [0, ["major", "suspended"]],
    [2, ["minor"]],
    [4, ["minor"]],
    [5, ["major"]],
    [7, ["major", "dominant", "suspended"]],
    [9, ["minor"]],
    [11, ["diminished", "half-diminished"]],
  ]),
  minor: new Map([
    [0, ["minor"]],
    [2, ["diminished", "half-diminished"]],
    [3, ["major"]],
    [5, ["minor"]],
    [7, ["minor", "major", "dominant", "suspended"]],
    [8, ["major"]],
    [10, ["major", "dominant"]],
  ]),
};

/**
 * The key that fits the chords best: chords whose root is in the key
 * score, more so when their kind fits too, and the first and last chord
 * count extra on the tonic. Null when there are no chords.
 */
export function estimateKey(chords: readonly ParsedChord[]): Key | null {
  if (!chords.length) return null;
  let best: { score: number; tonic: number; minor: boolean } | null = null;
  for (const minor of [false, true]) {
    const diatonic = DIATONIC[minor ? "minor" : "major"];
    for (let tonic = 0; tonic < 12; tonic++) {
      const fits = (c: ParsedChord) => diatonic.get((c.root - tonic + 12) % 12)?.includes(c.kind) ?? false;
      const onTonic = (c: ParsedChord) => c.root === tonic && fits(c);
      let score = 0;
      for (const c of chords) score += diatonic.has((c.root - tonic + 12) % 12) ? (fits(c) ? 2 : 1) : 0;
      if (onTonic(chords[0]!)) score += 2;
      if (onTonic(chords[chords.length - 1]!)) score += 3;
      if (!best || score > best.score) best = { score, tonic, minor };
    }
  }
  const { tonic, minor } = best!;
  return { tonic, minor, name: keyName(tonic, minor), estimated: true };
}

/** The name of a key from its tonic, e.g. (10, true) → "Bbm". */
export function keyName(tonic: number, minor: boolean): string {
  return `${NOTE_NAMES[((tonic % 12) + 12) % 12]}${minor ? "m" : ""}`;
}

/** The chords of the steps in play order, a new entry only where a chord is written (or repeated by a simile). */
function playedChords(steps: readonly PlayStep[]): Played[] {
  const out: Played[] = [];
  soundingChords(steps).forEach(({ chords, carried }, k) => {
    if (carried) return;
    chords.forEach((c, j) => {
      const parsed = parseChord(c.symbol);
      out.push({ symbol: c.symbol, chord: parsed, step: k, index: j, at: `${steps[k]!.index}:${j}` });
    });
  });
  return out;
}

interface Played {
  symbol: string;
  /** Null for "N.C." (and unreadable names), which break a progression. */
  chord: ParsedChord | null;
  /** Play-order step the chord is in. */
  step: number;
  /** Which of the step's sounding chords it is. */
  index: number;
  /** Written place of the chord (measure index and chord index), the same on every pass. */
  at: string;
}

/** The key written on the score, else the one estimated from its chords; null when there is neither. */
export function songKey(document: GtsDocument, steps: readonly PlayStep[]): Key | null {
  const written = document.meta.key ? parseKey(document.meta.key) : null;
  if (written) return written;
  return estimateKey(playedChords(steps).flatMap((p) => (p.chord ? [p.chord] : [])));
}

/** "F#m7-5" in the key of D → "Ⅲm7-5"; "Am/G" in Am → "Ⅰm/♭Ⅶ". Null for "N.C." and names that are not chords. */
export function degreeName(symbol: string, key: Key): string | null {
  const chord = parseChord(symbol);
  if (!chord) return null;
  const degree = (pc: number) => DEGREE_NAMES[(pc - key.tonic + 12) % 12]!;
  const quality = chord.quality.replace(/b(?=\d)/g, "♭").replace(/#/g, "♯");
  return `${degree(chord.root)}${quality}${chord.bass !== chord.root ? `/${degree(chord.bass)}` : ""}`;
}

/** A chord in the play order: the step, and which of its sounding chords (as soundingChords lists them). */
export interface ChordPlace {
  step: number;
  chord: number;
}

export interface ProgressionOccurrence {
  /** Play-order steps the progression spans, first to last. */
  steps: number[];
  /** Its first chord, and the chord it arrives at. */
  start: ChordPlace;
  end: ChordPlace;
  /** The chords as written, e.g. ["Bm7-5", "E7", "Am"]. */
  chords: string[];
  /** Their degrees in the key, e.g. ["Ⅱm7-5", "Ⅴ7", "Ⅰm"]. */
  degrees: string[];
}

export interface Progression {
  /** Which progression ("two-five-one", "komuro", ...); the viewer names and explains it. */
  id: string;
  /** Each place it is played, once per written place (repeats are not counted again), in play order. */
  occurrences: ProgressionOccurrence[];
}

const DOMINANT: ChordKind[] = ["dominant", "major", "suspended"];
const TONIC: ChordKind[] = ["major", "minor"];
const SUPERTONIC: ChordKind[] = ["minor", "half-diminished"];

interface PatternStep {
  /** Semitones above the pattern's reference note. */
  degree: number;
  kinds: readonly ChordKind[];
}

interface Pattern {
  id: string;
  /**
   * What the degrees count from: the key's tonic, the tonic of the major
   * key (the relative major in a minor key), or anywhere (the pattern is
   * looked for on every chord, as for secondary dominants).
   */
  from: "tonic" | "major" | "anywhere";
  steps: PatternStep[];
  /** Extra condition on the found chords. */
  accept?: (chords: readonly ParsedChord[], key: Key) => boolean;
}

const degreeStep = (degree: number, kinds: readonly ChordKind[]): PatternStep => ({ degree, kinds });

/** The progressions looked for, most telling first: a later one inside an earlier one's chords is not listed again. */
const PATTERNS: Pattern[] = [
  {
    id: "canon",
    from: "major",
    steps: [degreeStep(0, ["major"]), degreeStep(7, ["major", "dominant"]), degreeStep(9, ["minor"]), degreeStep(4, ["minor"])],
  },
  {
    id: "royal-road",
    from: "major",
    steps: [degreeStep(5, ["major"]), degreeStep(7, ["major", "dominant"]), degreeStep(4, ["minor"]), degreeStep(9, ["minor"])],
  },
  {
    id: "komuro",
    from: "major",
    steps: [degreeStep(9, ["minor"]), degreeStep(5, ["major"]), degreeStep(7, ["major", "dominant"]), degreeStep(0, ["major"])],
  },
  {
    id: "two-five-one",
    from: "anywhere",
    steps: [degreeStep(2, SUPERTONIC), degreeStep(7, DOMINANT), degreeStep(0, TONIC)],
  },
  {
    id: "cadence",
    from: "tonic",
    steps: [degreeStep(5, TONIC), degreeStep(7, DOMINANT), degreeStep(0, TONIC)],
  },
  {
    id: "dominant-motion",
    from: "tonic",
    steps: [degreeStep(7, DOMINANT), degreeStep(0, TONIC)],
  },
  {
    id: "secondary-dominant",
    from: "anywhere",
    steps: [degreeStep(7, ["dominant"]), degreeStep(0, TONIC)],
    accept: ([, target], key) => target!.root !== key.tonic,
  },
  {
    id: "two-five",
    from: "anywhere",
    steps: [degreeStep(2, SUPERTONIC), degreeStep(7, DOMINANT)],
    accept: ([, five], key) => five!.kind === "dominant" || (five!.root - key.tonic + 12) % 12 === 7,
  },
  {
    id: "plagal",
    from: "tonic",
    steps: [degreeStep(5, TONIC), degreeStep(0, TONIC)],
  },
];

/** Not part of the chain above: it is about one chord's voice, and shows wherever it is. */
const SUS4: Pattern = {
  id: "sus4",
  from: "anywhere",
  steps: [degreeStep(0, ["suspended"]), degreeStep(0, ["major", "dominant", "minor"])],
};

/** Consecutive chords on the same root, heard as one harmony (Esus4 → E, Am → Am/G). */
interface Harmony {
  first: Played;
  last: Played;
  /** Indices into the played chords. */
  from: number;
  to: number;
}

function harmonies(played: readonly Played[]): (Harmony | null)[] {
  const out: (Harmony | null)[] = [];
  played.forEach((p, i) => {
    const previous = out[out.length - 1];
    if (!p.chord) out.push(null);
    else if (previous && previous.last.chord!.root === p.chord.root) Object.assign(previous, { last: p, to: i });
    else out.push({ first: p, last: p, from: i, to: i });
  });
  return out;
}

interface Match {
  pattern: Pattern;
  from: number;
  to: number;
  chords: Played[];
}

/**
 * Where a pattern is played. A harmony leads on as its last chord and is
 * arrived at as its first ("Esus4 E → Am" resolves from E to Am).
 */
function matchesOf(pattern: Pattern, units: readonly (Harmony | null)[], key: Key): Match[] {
  const reference = { tonic: key.tonic, major: key.minor ? (key.tonic + 3) % 12 : key.tonic };
  const matches: Match[] = [];
  for (let i = 0; i + pattern.steps.length <= units.length; i++) {
    const group = units.slice(i, i + pattern.steps.length);
    if (group.some((u) => !u)) continue;
    const chosen = group.map((u, s) => (s === group.length - 1 ? u!.first : u!.last));
    const chords = chosen.map((p) => p.chord!);
    const base =
      pattern.from === "anywhere" ? (chords[0]!.root - pattern.steps[0]!.degree + 12) % 12 : reference[pattern.from];
    const fits = pattern.steps.every(
      (s, j) => (chords[j]!.root - base + 12) % 12 === s.degree && s.kinds.includes(chords[j]!.kind),
    );
    if (fits && (pattern.accept?.(chords, key) ?? true)) {
      matches.push({ pattern, from: group[0]!.from, to: group[group.length - 1]!.from, chords: chosen });
    }
  }
  return matches;
}

/** Same-root chords one after the other, the first a sus4. */
function findSus4(played: readonly Played[]): Match[] {
  const matches: Match[] = [];
  played.forEach((p, i) => {
    const next = played[i + 1];
    if (!p.chord || !next?.chord || p.chord.root !== next.chord.root) return;
    if (p.chord.kind === "suspended" && SUS4.steps[1]!.kinds.includes(next.chord.kind)) {
      matches.push({ pattern: SUS4, from: i, to: i + 1, chords: [p, next] });
    }
  });
  return matches;
}

/**
 * The well-known progressions of a song, most telling first, each with
 * where it is played. A progression inside the chords of one listed
 * before it is left out there (the Ⅴ→Ⅰ of a Ⅱ→Ⅴ→Ⅰ), so each place is
 * explained once; sus4 resolutions are listed on their own.
 */
export function progressions(steps: readonly PlayStep[], key: Key): Progression[] {
  const played = playedChords(steps);
  const units = harmonies(played);
  const taken: { from: number; to: number }[] = [];
  const out: Progression[] = [];
  const add = (pattern: Pattern, matches: Match[], claim: boolean) => {
    const seen = new Set<string>();
    const occurrences: ProgressionOccurrence[] = [];
    for (const m of matches) {
      if (claim && taken.some((t) => t.from <= m.from && m.to <= t.to)) continue;
      if (claim) taken.push(m);
      const at = played[m.from]!.at;
      if (seen.has(at)) continue;
      seen.add(at);
      const first = played[m.from]!.step;
      const last = played[m.to]!.step;
      occurrences.push({
        steps: Array.from({ length: last - first + 1 }, (_, n) => first + n),
        start: { step: first, chord: played[m.from]!.index },
        end: { step: last, chord: played[m.to]!.index },
        chords: m.chords.map((p) => p.symbol),
        degrees: m.chords.map((p) => degreeName(p.symbol, key)!),
      });
    }
    if (occurrences.length) out.push({ id: pattern.id, occurrences });
  };
  for (const pattern of PATTERNS) add(pattern, matchesOf(pattern, units, key), true);
  add(SUS4, findSus4(played), false);
  return out;
}

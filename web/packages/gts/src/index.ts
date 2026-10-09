/**
 * gts (Guitar Tab Score) documents: generated types and small helpers
 * shared by the tools and the PWA. Schema validation lives in
 * "@guitarmr/gts/validate" so that ajv stays a development dependency.
 */

import type { Beat, GuitarTabScoreGts, Measure } from "./types.generated.ts";

export type * from "./types.generated.ts";
export * from "./playback.ts";
export type GtsDocument = GuitarTabScoreGts;

/** Every measure in written order. */
export function measures(document: GtsDocument): Measure[] {
  return document.sections.flatMap((s) => s.measures);
}

/** Length of a beat as a fraction of a whole note, [numerator, denominator]. */
export function beatLength(beat: Beat): [number, number] {
  const d = beat.duration;
  let num = 1;
  let den = d.value;
  // Each dot adds half of the previous value: 1 + 1/2 + 1/4 ...
  for (let i = 0; i < (d.dots ?? 0); i++) {
    num = num * 2 + 1;
    den *= 2;
  }
  if (d.tuplet) {
    num *= d.tuplet[1];
    den *= d.tuplet[0];
  }
  return reduce(num, den);
}

/** Sum of beat lengths of a measure as a reduced fraction. */
export function measureLength(measure: Measure): [number, number] {
  return (measure.beats ?? []).map(beatLength).reduce<[number, number]>(
    ([an, ad], [bn, bd]) => reduce(an * bd + bn * ad, ad * bd),
    [0, 1],
  );
}

function reduce(num: number, den: number): [number, number] {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(num, den) || 1;
  return [num / g, den / g];
}

export type ChordEntry = NonNullable<Measure["chords"]>[number];

/** Same rule as the schema's chordSymbol. */
export const CHORD_SYMBOL = /^(N\.C\.|[A-G][#b]?[^\s/]*(\/[A-G][#b]?)?)$/;

/** Beats per measure of a time signature such as "3/4" (4 when absent). */
export function beatsPerBar(timeSignature?: string): number {
  const n = Number(timeSignature?.split("/")[0]);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

/** Default chord positions: n chords split the measure evenly (2 in 4/4 → beats 1 and 3). */
export function evenBeats(count: number, perBar = 4): number[] {
  return Array.from({ length: count }, (_, i) => Math.round((1 + (perBar * i) / count) * 100) / 100);
}

/**
 * Chords as one line of text for editing: "Am E7", with "@beat" only where
 * a chord is not at its even default position ("Am E7@4").
 */
export function formatChordLine(chords: readonly ChordEntry[] = [], perBar = 4): string {
  const even = evenBeats(chords.length, perBar);
  return chords.map((c, i) => ((c.beat ?? 1) === even[i] ? c.symbol : `${c.symbol}@${c.beat ?? 1}`)).join(" ");
}

/** Inverse of formatChordLine; tokens that are not a chord (or have a bad beat) are returned in `invalid`. */
export function parseChordLine(text: string, perBar = 4): { chords: ChordEntry[]; invalid: string[] } {
  const tokens = text.replace(/\u3000/g, " ").trim().split(/\s+/).filter(Boolean);
  const even = evenBeats(tokens.length, perBar);
  const chords: ChordEntry[] = [];
  const invalid: string[] = [];
  tokens.forEach((token, i) => {
    const [symbol = "", at] = token.split("@");
    const beat = at === undefined ? even[i]! : Number(at);
    if (CHORD_SYMBOL.test(symbol) && beat >= 1 && beat < perBar + 1) chords.push({ symbol, beat });
    else invalid.push(token);
  });
  return { chords, invalid };
}

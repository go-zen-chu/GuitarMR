/**
 * Playback order: the measures of a score in the order they are played,
 * expanding repeats, 1st/2nd endings, D.S./D.C. with Coda and Fine, and
 * resolving what is sounding in measures that write no chord. Pure
 * functions over a gts document, shared by the phone viewer and (later)
 * the Quest app's follow-along.
 */

import type { GuitarTabScoreGts as GtsDocument, Measure } from "./types.generated.ts";

type ChordEntry = NonNullable<Measure["chords"]>[number];

export interface PlayStep {
  measure: Measure;
  /** Index of the measure in written order. */
  index: number;
  /** Which time through the enclosing repeat (1, 2, ...); picks lyrics verses. */
  pass: number;
  /** Rehearsal mark of the section starting at this measure, if any. */
  section?: string;
  /** Beats in this measure (from its time signature, else the score's). */
  beats: number;
  /** Beat position where this step starts, counted from the start of the song. */
  start: number;
}

/** Longest expansion accepted; guards against a malformed jump loop. */
export const MAX_STEPS = 5000;

function beatsOf(timeSignature: string | undefined): number {
  const n = Number(timeSignature?.split("/")[0]);
  return Number.isInteger(n) && n > 0 ? n : 4;
}

/**
 * The play order. Conventions: a repeat-end jumps back to the nearest
 * repeat-start before it (or the beginning) until it has been played
 * `repeatTimes` times (default 2); an ending bracket is played on the
 * passes it lists. D.S./D.C. jump to the segno/beginning once; after the
 * jump, repeats are not taken again and only the last ending is played;
 * "to-coda" then jumps to the coda sign (al Coda) and "fine" ends (plain
 * D.S./D.C.).
 */
export function playOrder(document: GtsDocument): PlayStep[] {
  const written = document.sections.flatMap((s) =>
    s.measures.map((measure, i) => ({ measure, section: i === 0 ? s.label : undefined })),
  );
  const n = written.length;
  const steps: PlayStep[] = [];
  const timesPlayed = new Map<number, number>(); // repeat-end index → passes done
  let pass = 1;
  let jumped: "" | "plain" | "al-coda" = "";
  let timeSignature = document.meta.timeSignature;
  let start = 0;
  const has = (m: Measure, nav: string) => m.navigation?.includes(nav as never) ?? false;
  const find = (from: number, nav: string) => {
    for (let j = from; j < n; j++) if (has(written[j]!.measure, nav)) return j;
    return -1;
  };
  // After a jump only the last ending of a bracket group is played.
  const lastEnding = (i: number): number => {
    let lo = i;
    let hi = i;
    while (lo > 0 && written[lo - 1]!.measure.volta) lo--;
    while (hi < n - 1 && written[hi + 1]!.measure.volta) hi++;
    return Math.max(...written.slice(lo, hi + 1).flatMap((w) => w.measure.volta ?? []));
  };

  let i = 0;
  while (i < n && steps.length < MAX_STEPS) {
    const { measure, section } = written[i]!;
    if (measure.volta) {
      const wanted = jumped ? lastEnding(i) : pass;
      if (!measure.volta.includes(wanted)) {
        i++;
        continue;
      }
    }
    if (measure.timeSignature) timeSignature = measure.timeSignature;
    const beats = beatsOf(timeSignature);
    steps.push({ measure, index: i, pass, ...(section ? { section } : {}), beats, start });
    start += beats;

    if (jumped === "al-coda" && has(measure, "to-coda")) {
      const coda = find(i + 1, "coda");
      if (coda >= 0) {
        i = coda;
        continue;
      }
    }
    if (jumped === "plain" && has(measure, "fine")) break;
    if (measure.barEnd === "repeat-end" && !jumped) {
      const times = measure.repeatTimes ?? 2;
      const done = timesPlayed.get(i) ?? 1;
      if (done < times) {
        timesPlayed.set(i, done + 1);
        pass = done + 1;
        let back = i;
        while (back > 0 && written[back]!.measure.barStart !== "repeat-start") back--;
        i = back;
        continue;
      }
      timesPlayed.delete(i);
    }
    if (!jumped) {
      const ds = has(measure, "ds") ? "plain" : has(measure, "ds-al-coda") ? "al-coda" : "";
      const dc = has(measure, "dc") ? "plain" : has(measure, "dc-al-coda") ? "al-coda" : "";
      if (ds || dc) {
        jumped = (ds || dc) as "plain" | "al-coda";
        pass = 1;
        i = ds ? Math.max(find(0, "segno"), 0) : 0;
        continue;
      }
    }
    // Passes count from 1 again for a new repeat, and after the endings of
    // a finished one.
    const next = i + 1 < n ? written[i + 1]!.measure : undefined;
    if (next?.barStart === "repeat-start" || (measure.volta && !next?.volta)) pass = 1;
    i++;
  }
  return steps;
}

export interface SoundingChords {
  chords: ChordEntry[];
  /** True when nothing is written in the measure and the chords shown carry over. */
  carried: boolean;
}

/**
 * The chords to show for each step: the measure's own; for a simile
 * measure without chords, those of the measure(s) it repeats; otherwise
 * the last chord still sounding, marked as carried.
 */
export function soundingChords(steps: readonly PlayStep[]): SoundingChords[] {
  const out: SoundingChords[] = [];
  steps.forEach((step, k) => {
    const own = step.measure.chords ?? [];
    if (own.length) {
      out.push({ chords: own, carried: false });
      return;
    }
    const simile = step.measure.simile;
    if (simile && k - simile >= 0) {
      out.push({ chords: out[k - simile]!.chords, carried: false });
      return;
    }
    const previous = out[k - 1]?.chords ?? [];
    const last = previous[previous.length - 1];
    out.push({ chords: last ? [{ ...last, beat: 1 }] : [], carried: true });
  });
  return out;
}

/** Lyrics for a step: the verse matching its pass, else verse 1. */
export function lyricsFor(step: PlayStep): string | undefined {
  const lyrics = step.measure.lyrics ?? [];
  return (lyrics.find((l) => l.verse === step.pass) ?? lyrics.find((l) => l.verse === 1))?.text;
}

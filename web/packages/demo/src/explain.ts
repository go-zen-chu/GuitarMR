/**
 * The play view's explanation: a note on the key the degrees count from,
 * brackets over the measures where the song's telling progressions are
 * played (named at their start), and the details of a progression when
 * its name is tapped; the song's scale, whose details (notes, sound and
 * where they lie on the fretboard) open the same way. player.ts places the
 * brackets under the chords and wires the taps through `data-pick` /
 * `data-place` and `data-scale`.
 */

import {
  type Key,
  type PlayStep,
  type Progression,
  type ScaleFit,
  type SongScale,
  type SoundingChords,
  keyName,
  noteNamesIn,
  sameNoteScales,
  scaleStepName,
} from "@guitarmr/gts";
import type { Messages } from "./i18n.ts";
import { SVG, prettyChord } from "./player.ts";

/** Progressions shown in the score; the rest are the less telling ones. */
export const SHOWN_PROGRESSIONS = 5;
/** Beats a bracket keeps to itself on its line, so that its name has room before the next one. */
const NAME_ROOM = 4;

/** The part of one bracket that falls in one measure. */
export interface BracketPiece {
  /** Index into the shown progressions, and which of its places. */
  progression: number;
  place: number;
  /** Line of the bracket lane, 0 at the top. */
  track: number;
  /** The sounding chord the piece starts on, or null from the start of the measure. */
  fromChord: number | null;
  /** The sounding chord it ends with, or null to the end of the measure. */
  toChord: number | null;
}

/**
 * The bracket pieces of each play-order step, and how many lines the
 * brackets need. Each bracket takes the first line free at its start.
 */
export function brackets(list: readonly Progression[], steps: readonly PlayStep[], sounding: readonly SoundingChords[]) {
  const at = (step: number, chord: number) => steps[step]!.start + (sounding[step]!.chords[chord]?.beat ?? 1) - 1;
  const spans = list.slice(0, SHOWN_PROGRESSIONS).flatMap((p, progression) =>
    p.occurrences.map((o, place) => ({ o, progression, place, from: at(o.start.step, o.start.chord) })),
  );
  spans.sort((a, b) => a.from - b.from || a.progression - b.progression);
  const lineEnds: number[] = [];
  const pieces = new Map<number, BracketPiece[]>();
  for (const { o, progression, place, from } of spans) {
    const end = sounding[o.end.step]!.chords[o.end.chord + 1]?.beat;
    const until = end === undefined ? steps[o.end.step]!.start + steps[o.end.step]!.beats : steps[o.end.step]!.start + end - 1;
    let track = lineEnds.findIndex((e) => e <= from);
    if (track < 0) track = lineEnds.length;
    lineEnds[track] = Math.max(until, from + NAME_ROOM);
    for (const k of o.steps) {
      const piece: BracketPiece = {
        progression,
        place,
        track,
        fromChord: k === o.start.step ? o.start.chord : null,
        toChord: k === o.end.step ? o.end.chord : null,
      };
      pieces.set(k, [...(pieces.get(k) ?? []), piece]);
    }
  }
  return { pieces, tracks: lineEnds.length };
}

/** Frets drawn on the scale's fretboard, from the open strings (or the capo). */
const FRETBOARD_FRETS = 12;

/** "A マイナー", "C major". */
function keyLabel(key: Key, text: Messages): string {
  return `${noteNamesIn(key)[key.tonic]} ${key.minor ? text.minorKey : text.majorKey}`;
}

/** "A ヨナ抜き短音階（平調子）", "A yonanuki minor (hirajōshi)". */
function scaleLabel(fit: ScaleFit, key: Key, text: Messages): string {
  return `${noteNamesIn(key)[fit.tonic]} ${text.scales[fit.scale.id]?.name ?? fit.scale.id}`;
}

/** "A Hirajoshi scale": the English name next to a Japanese one; empty in English. */
function scaleAlias(fit: ScaleFit, key: Key, text: Messages): string {
  const alias = text.scales[fit.scale.id]?.alias;
  return alias ? `${noteNamesIn(key)[fit.tonic]} ${alias}` : "";
}

/** The scale's notes from its tonic, as the key spells them. */
function scaleNotes(fit: ScaleFit, key: Key): string[] {
  return fit.scale.intervals.map((i) => noteNamesIn(key)[(fit.tonic + i) % 12]!);
}

/** A button that opens the details of a scale ("main" or the index of another one), its English name under a Japanese one. */
function scaleButton(fit: ScaleFit, key: Key, text: Messages, which: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scale-name";
  button.dataset.scale = which;
  const name = document.createElement("span");
  name.textContent = scaleLabel(fit, key, text);
  button.append(name);
  const alias = scaleAlias(fit, key, text);
  if (alias) {
    const small = document.createElement("small");
    small.className = "scale-alias";
    small.textContent = alias;
    button.append(small);
  }
  return button;
}

/** The lines above the measures: the key and the scale, what the degrees count from, and what to tap. */
export function keyNote(key: Key, scale: SongScale | null, capo: number, found: number, text: Messages): HTMLElement[] {
  const head = document.createElement("p");
  head.className = "notes-head";
  head.append(text.aside(`Key ${prettyChord(key.name)}`, keyLabel(key, text)));
  if (scale) {
    head.append(text.scaleIntro, scaleButton(scale.main, key, text, "main"));
    const notes = document.createElement("span");
    notes.className = "scale-notes";
    notes.textContent = scaleNotes(scale.main, key).join(" ");
    head.append(notes);
  }
  const lines = [head];
  if (scale?.others.length) {
    const others = document.createElement("p");
    others.className = "notes-others";
    others.append(text.otherScales);
    scale.others.forEach((fit, i) => others.append(scaleButton(fit, key, text, String(i))));
    lines.push(others);
  }
  const note = document.createElement("p");
  note.className = "notes-key";
  const sounding = capo ? text.soundingKey(capo, prettyChord(keyName(key.tonic + capo, key.minor))) : "";
  const hint = found ? text.tapHint : text.noProgressions;
  note.textContent = `${text.degreesNote(key.estimated ? text.fromChords : text.fromScore)}${sounding}${hint}`;
  lines.push(note);
  return lines;
}

/**
 * Where a scale's notes lie on the neck: strings 1 (top) to 6, frets 0 to
 * 12 as written (from the capo), the tonic filled.
 */
function fretboard(fit: ScaleFit, tuning: readonly number[]): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const fretX = (f: number) => 22 + f * 26;
  const stringY = (s: number) => 10 + s * 14;
  const width = fretX(FRETBOARD_FRETS) + 14;
  svg.setAttribute("viewBox", `0 0 ${width} ${stringY(5) + 24}`);
  svg.setAttribute("class", "fretboard");
  svg.setAttribute("role", "img");
  const add = (name: string, attrs: Record<string, string | number>, text?: string) => {
    const el = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (text) el.textContent = text;
    svg.append(el);
  };
  for (let f = 0; f <= FRETBOARD_FRETS; f++) {
    add("line", { x1: fretX(f), y1: stringY(0), x2: fretX(f), y2: stringY(5), class: f === 0 ? "fb-nut" : "fb-fret" });
    if ([3, 5, 7, 9, 12].includes(f)) add("text", { x: fretX(f) - 13, y: stringY(5) + 18, class: "fb-number", "text-anchor": "middle" }, String(f));
  }
  for (let s = 0; s < 6; s++) add("line", { x1: fretX(0), y1: stringY(s), x2: fretX(FRETBOARD_FRETS), y2: stringY(s), class: "fb-string" });
  const inScale = new Set(fit.scale.intervals.map((i) => (fit.tonic + i) % 12));
  tuning.slice(0, 6).forEach((open, s) => {
    for (let f = 0; f <= FRETBOARD_FRETS; f++) {
      const pc = (open + f) % 12;
      if (!inScale.has(pc)) continue;
      const x = f === 0 ? fretX(0) - 10 : fretX(f) - 13;
      add("circle", { cx: x, cy: stringY(s), r: 5, class: pc === fit.tonic ? "fb-root" : "fb-note" });
    }
  });
  return svg;
}

/** The details of a scale: its notes and their steps, its sound, the same notes under other names, and the fretboard. */
export function scaleDetail(fit: ScaleFit, key: Key, scale: SongScale, tuning: readonly number[], text: Messages): Element[] {
  const heading = document.createElement("h3");
  heading.textContent = scaleLabel(fit, key, text);
  const out: Element[] = [heading];
  const alias = scaleAlias(fit, key, text);
  if (alias) {
    const english = document.createElement("p");
    english.className = "detail-alias";
    english.textContent = alias;
    out.push(english);
  }
  const notes = document.createElement("p");
  notes.className = "detail-notes";
  const names = scaleNotes(fit, key);
  fit.scale.intervals.forEach((interval, i) => {
    const note = document.createElement("span");
    note.className = interval === 0 ? "scale-note root" : "scale-note";
    const name = document.createElement("b");
    name.textContent = names[i]!;
    const step = document.createElement("small");
    step.textContent = scaleStepName(interval);
    note.append(name, step);
    notes.append(note);
  });
  const description = document.createElement("p");
  description.className = "detail-text";
  description.textContent = text.scales[fit.scale.id]?.description ?? "";
  out.push(notes, description);
  const same = sameNoteScales(fit);
  if (same.length) {
    const also = document.createElement("p");
    also.className = "detail-chords";
    also.textContent = text.sameNotes(
      same.map((f) => [scaleLabel(f, key, text), scaleAlias(f, key, text)].filter(Boolean).join(" / ")).join(text.listSeparator),
    );
    out.push(also);
  }
  const basis = document.createElement("p");
  basis.className = "detail-chords";
  const counted = scale.from === "melody" ? text.fromMelody : text.fromChordTones;
  const outside = scale.weights.flatMap((w, pc) =>
    w > 0 && !fit.scale.intervals.includes((pc - fit.tonic + 12) % 12) ? [noteNamesIn(key)[pc]!] : [],
  );
  basis.textContent =
    text.coverage(counted, Math.round(fit.coverage * 100)) + (outside.length ? text.outside(outside.join(" ")) : "") + text.sentenceEnd;
  const board = fretboard(fit, tuning);
  board.setAttribute("aria-label", text.onFretboard(heading.textContent));
  out.push(basis, board);
  return out;
}

/** The details of one place of a progression, with its other places to go to. */
export function progressionDetail(progression: Progression, index: number, place: number, text: Messages): HTMLElement[] {
  const occurrence = progression.occurrences[place]!;
  const about = text.progressions[progression.id];
  const heading = document.createElement("h3");
  heading.textContent = about?.name ?? progression.id;
  const degrees = document.createElement("p");
  degrees.className = "detail-degrees";
  degrees.textContent = occurrence.degrees.join(" → ");
  const chords = document.createElement("p");
  chords.className = "detail-chords";
  chords.textContent = text.aside(occurrence.chords.map(prettyChord).join(" → "), text.fromMeasure(occurrence.steps[0]! + 1));
  const description = document.createElement("p");
  description.className = "detail-text";
  description.textContent = about?.description ?? "";
  const out = [heading, degrees, chords, description];
  if (progression.occurrences.length > 1) {
    const places = document.createElement("p");
    places.className = "detail-places";
    places.append(text.placesInSong);
    progression.occurrences.forEach((o, n) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "detail-place";
      button.dataset.pick = String(index);
      button.dataset.place = String(n);
      button.textContent = text.measureShort(o.steps[0]! + 1);
      button.setAttribute("aria-label", `${text.measureLabel(o.steps[0]! + 1)} ${o.chords.join(" ")}`);
      if (n === place) button.setAttribute("aria-current", "true");
      places.append(button);
    });
    out.push(places);
  }
  return out;
}

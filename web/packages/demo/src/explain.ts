/**
 * The play view's explanation: a note on the key the degrees count from,
 * brackets over the measures where the song's telling progressions are
 * played (named at their start), and the details of a progression when
 * its name is tapped; the song's scale, whose details (notes, sound and
 * where they lie on the fretboard) open the same way; and the key on the
 * circle of fifths, with its diatonic chords and their substitutes; and the
 * arrange board, the safe notes on the neck over the chord sounding now. player.ts
 * places the brackets under the chords and wires the taps through
 * `data-pick` / `data-place`, `data-scale`, `data-circle` and `data-arrange`.
 */

import {
  CIRCLE_OF_FIFTHS,
  type Key,
  type KeyChord,
  type ParsedChord,
  type PlayStep,
  type Progression,
  type ScaleFit,
  type SongScale,
  type SoundingChords,
  chordName,
  degreeName,
  diatonicChords,
  keyName,
  keyScaleFit,
  noteNamesIn,
  parseChord,
  playsChord,
  relatedKeys,
  safeFrets,
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
  const circle = document.createElement("button");
  circle.type = "button";
  circle.className = "scale-name circle-open";
  circle.dataset.circle = "key";
  circle.textContent = text.circleButton;
  const arrange = document.createElement("button");
  arrange.type = "button";
  arrange.className = "scale-name arrange-toggle";
  arrange.dataset.arrange = "";
  arrange.setAttribute("aria-pressed", "false");
  arrange.textContent = text.arrangeButton;
  head.append(circle, arrange);
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

/** Standard names on the circle, clockwise from C: the major keys outside, their relative minors inside. */
const CIRCLE_MAJORS = ["C", "G", "D", "A", "E", "B", "F♯", "D♭", "A♭", "E♭", "B♭", "F"];
const CIRCLE_MINORS = ["Am", "Em", "Bm", "F♯m", "C♯m", "G♯m", "E♭m", "B♭m", "Fm", "Cm", "Gm", "Dm"];

/** Where a chord of the key sits on the circle: outside for major and dominant chords, inside for minor ones. */
function circleCell(chord: KeyChord, key: Key): { ring: "major" | "minor"; index: number } {
  const root = (key.tonic + chord.interval) % 12;
  const minor = chord.quality.startsWith("m") && !chord.quality.startsWith("M");
  return minor ? { ring: "minor", index: CIRCLE_OF_FIFTHS.indexOf((root + 3) % 12) } : { ring: "major", index: CIRCLE_OF_FIFTHS.indexOf(root) };
}

/**
 * The circle of fifths: the major keys outside and their relative minors
 * inside, the key filled, its diatonic chords tinted with their degrees, and
 * the scale's notes dotted around the rim.
 */
function circleOfFifths(key: Key, fit: ScaleFit, text: Messages): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const center = 130;
  svg.setAttribute("viewBox", `0 0 ${center * 2} ${center * 2}`);
  svg.setAttribute("class", "circle-of-fifths");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", text.circleTitle(keyLabel(key, text)));
  const add = (name: string, attrs: Record<string, string | number>, label?: string) => {
    const el = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (label) el.textContent = label;
    svg.append(el);
    return el;
  };
  const point = (index: number, radius: number, turn = 0) => {
    const angle = ((index * 30 + turn - 90) * Math.PI) / 180;
    return [center + radius * Math.cos(angle), center + radius * Math.sin(angle)] as const;
  };
  const cell = (index: number, inner: number, outer: number) => {
    const [a, b] = [point(index, outer, -15), point(index, outer, 15)];
    const [c, d] = [point(index, inner, 15), point(index, inner, -15)];
    return `M${a} A${outer} ${outer} 0 0 1 ${b} L${c} A${inner} ${inner} 0 0 0 ${d} Z`;
  };
  const rings = { major: { inner: 80, outer: 114, names: CIRCLE_MAJORS }, minor: { inner: 44, outer: 80, names: CIRCLE_MINORS } };
  const degrees = new Map<string, string>();
  for (const { chord } of diatonicChords(key)) {
    const { ring, index } = circleCell(chord, key);
    degrees.set(`${ring}:${index}`, degreeName(chordName(chord, key), key)!);
  }
  const own = { ring: key.minor ? "minor" : "major", index: CIRCLE_OF_FIFTHS.indexOf(key.minor ? (key.tonic + 3) % 12 : key.tonic) };
  for (const [ring, { inner, outer, names }] of Object.entries(rings)) {
    names.forEach((name, index) => {
      const degree = degrees.get(`${ring}:${index}`);
      const isKey = ring === own.ring && index === own.index;
      add("path", { d: cell(index, inner, outer), class: isKey ? "cf-cell cf-key" : degree ? "cf-cell cf-diatonic" : "cf-cell" });
      const [x, y] = point(index, (inner + outer) / 2);
      const label = add("text", { x, y: degree ? y - 2 : y + 4, class: isKey ? "cf-name cf-on-key" : "cf-name", "text-anchor": "middle" }, name);
      if (ring === "minor") label.classList.add("cf-minor");
      if (degree) add("text", { x, y: y + 9, class: isKey ? "cf-degree cf-on-key" : "cf-degree", "text-anchor": "middle" }, degree);
    });
  }
  const inScale = new Set(fit.scale.intervals.map((i) => (fit.tonic + i) % 12));
  CIRCLE_OF_FIFTHS.forEach((pc, index) => {
    if (!inScale.has(pc)) return;
    const [x, y] = point(index, 121);
    add("circle", { cx: x, cy: y, r: pc === fit.tonic ? 5 : 3.5, class: pc === fit.tonic ? "cf-dot cf-tonic" : "cf-dot" });
  });
  return svg;
}

/** One chord of the key: its degree, its name, and whether the song plays it. */
function keyChordLabel(chord: KeyChord, key: Key, played: readonly ParsedChord[], text: Messages, className: string): HTMLElement {
  const name = chordName(chord, key);
  const out = document.createElement("span");
  out.className = className;
  const strong = document.createElement("b");
  strong.textContent = prettyChord(name);
  const degree = document.createElement("small");
  degree.textContent = degreeName(name, key)!;
  out.append(strong, degree);
  if (playsChord(played, chord, key)) {
    out.classList.add("in-song");
    const mark = document.createElement("i");
    mark.className = "kc-played";
    mark.textContent = text.inSong;
    out.append(mark);
  }
  return out;
}

/**
 * The key on the circle of fifths: the notes to use, the diatonic chords
 * with their functions and the chords that can stand in for each, and the
 * keys next to it. `played` are the song's chords, marked where they appear.
 */
export function circleDetail(key: Key, scale: SongScale | null, played: readonly ParsedChord[], text: Messages): Element[] {
  const heading = document.createElement("h3");
  heading.textContent = text.circleTitle(keyLabel(key, text));
  const own = keyScaleFit(key);
  const fit = scale?.main ?? own;
  const legend = document.createElement("p");
  legend.className = "detail-chords";
  legend.textContent = text.circleLegend;
  const usable = document.createElement("p");
  usable.className = "detail-chords";
  usable.textContent = text.usableNotes(scaleLabel(fit, key, text));
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
  const basis = document.createElement("p");
  basis.className = "detail-chords";
  basis.textContent = text.keyScaleNotes(scaleLabel(own, key, text), scaleNotes(own, key).join(" "));
  const chordsHeading = document.createElement("h4");
  chordsHeading.className = "detail-subhead";
  chordsHeading.textContent = text.diatonicHeading;
  const list = document.createElement("ul");
  list.className = "key-chords";
  for (const { chord, substitutes } of diatonicChords(key)) {
    const row = document.createElement("li");
    row.className = "key-chord";
    row.dataset.step = String(chord.step);
    const fn = document.createElement("span");
    fn.className = `kc-function fn-${chord.function}`;
    fn.textContent = text.functions[chord.function];
    fn.title = text.functionNames[chord.function];
    row.append(fn, keyChordLabel(chord, key, played, text, "kc-chord"));
    if (substitutes.length) {
      const subs = document.createElement("span");
      subs.className = "kc-subs";
      subs.append("→");
      for (const s of substitutes) {
        const sub = keyChordLabel(s.chord, key, played, text, "kc-sub");
        sub.dataset.kind = s.kind;
        sub.querySelector("small")!.append(` · ${text.substituteKinds[s.kind]}`);
        subs.append(sub);
      }
      row.append(subs);
    }
    list.append(row);
  }
  const about = document.createElement("p");
  about.className = "detail-text";
  about.textContent = text.substituteNote;
  const related = relatedKeys(key);
  const near = document.createElement("p");
  near.className = "detail-chords";
  near.textContent = text.relatedKeys(
    (Object.keys(related) as (keyof typeof related)[])
      .map((k) => `${text.relatedNames[k]} ${prettyChord(related[k].name)}`)
      .join(text.listSeparator),
  );
  const out: Element[] = [heading, circleOfFifths(key, fit, text), legend, usable, notes];
  if (fit.scale.id !== own.scale.id) out.push(basis);
  out.push(chordsHeading, list, about, near);
  return out;
}

/**
 * The neck drawn like a tab: string 1 at the top, each safe note written as
 * its fret number on its string, the chord's tones filled (the safest), the
 * rest of the scale outlined, and the tonic ringed.
 */
function safeNotesTab(fit: ScaleFit, chord: ParsedChord | null, tuning: readonly number[], label: string): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const fretX = (f: number) => 26 + f * 26;
  const stringY = (s: number) => 12 + (s - 1) * 16;
  svg.setAttribute("viewBox", `0 0 ${fretX(FRETBOARD_FRETS) + 14} ${stringY(6) + 22}`);
  svg.setAttribute("class", "arrange-tab");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  const add = (name: string, attrs: Record<string, string | number>, content?: string) => {
    const el = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    if (content !== undefined) el.textContent = content;
    svg.append(el);
  };
  add("text", { x: 4, y: stringY(3) + 4, class: "at-label" }, "T");
  add("text", { x: 4, y: stringY(4) + 4, class: "at-label" }, "A");
  add("text", { x: 4, y: stringY(5) + 4, class: "at-label" }, "B");
  for (let s = 1; s <= 6; s++) add("line", { x1: 14, y1: stringY(s), x2: fretX(FRETBOARD_FRETS) + 10, y2: stringY(s), class: "at-string" });
  for (const f of [3, 5, 7, 9, 12]) add("text", { x: fretX(f), y: stringY(6) + 19, class: "at-number", "text-anchor": "middle" }, String(f));
  for (const n of safeFrets(fit, chord, tuning, FRETBOARD_FRETS)) {
    const [x, y] = [fretX(n.fret), stringY(n.string)];
    if (n.tonic) add("circle", { cx: x, cy: y, r: 8.5, class: "at-tonic" });
    add("circle", { cx: x, cy: y, r: 6.5, class: n.role === "chord-tone" ? "at-note at-chord-tone" : "at-note at-scale" });
    add("text", { x, y: y + 3, class: n.role === "chord-tone" ? "at-fret at-on-chord" : "at-fret", "text-anchor": "middle" }, String(n.fret));
  }
  return svg;
}

/**
 * The arrange board: over the chord `symbol` (null when none sounds) in
 * measure `step`, the notes that stay in the song's scale, laid on the neck
 * like a tab; the chord's own tones are the safe bet.
 */
export function arrangeBoard(fit: ScaleFit, symbol: string | null, key: Key, step: number, tuning: readonly number[], text: Messages): Element[] {
  const chord = symbol ? parseChord(symbol) : null;
  const head = document.createElement("p");
  head.className = "arrange-head";
  const title = document.createElement("b");
  title.textContent = chord ? text.arrangeOver(text.aside(prettyChord(symbol!), degreeName(symbol!, key)!)) : text.arrangeNoChord;
  const where = document.createElement("span");
  where.textContent = `${text.measureLabel(step + 1)} · ${scaleLabel(fit, key, text)}`;
  head.append(title, where);
  const legend = document.createElement("p");
  legend.className = "arrange-legend";
  legend.textContent = chord ? text.arrangeLegend : text.arrangeLegendScale;
  return [head, safeNotesTab(fit, chord, tuning, title.textContent), legend];
}

/**
 * Reading the tab layer (rhythm and frets) with Claude, after structure
 * and chords: the same system crops, an instruction teaching the tab line
 * notation of @guitarmr/gts (formatTabLine), and an answer of one line per
 * measure, parsed by the same parser as the review editor. What cannot be
 * read is dropped and reported; the checks (beats filling the time
 * signature, playable chords, ties) mark measures for review.
 */

import { type Beat, type GtsDocument, measures, parseTabLine } from "@guitarmr/gts";
import { checkTab, timeSignatures } from "./checks.ts";
import type { SystemCrop } from "./crops.ts";
import { ATTENTION_BELOW, isObject } from "./reading.ts";

export function tabPrompt(crops: readonly SystemCrop[], simile: ReadonlySet<string> = new Set()): string {
  const systems = crops
    .map((c, i) => {
      const ids = c.measures.map((m) => (simile.has(m.id) ? `${m.id} (repeat sign, skip)` : m.id));
      return `- Image ${i + 1}: measures ${ids.join(", ")} (left to right)`;
    })
    .join("\n");
  return `You are digitizing a handwritten guitar score (a scan). The images
are crops of one page, one image per system (a line of music: an optional
5-line staff above a 6-line TAB staff, with chord names above it and the
rhythm written below the TAB as stems, beams and flags). A white strip was
added on top of each image: magenta ticks mark where each measure starts
and ends, and a magenta tag with the measure id sits above its left end.
The strip is not part of the score. The faded margins above and below are
the neighboring systems: do not read them into these measures.

${systems}

For every listed measure, read its TAB and rhythm as one "tab line": one
token per beat (note, chord, rest or strum) in time order, separated by
spaces. A token is <length>:<content>, optionally followed by !<marks>.
- length: 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth, 32; add "."
  for a dotted note (".." double dotted); add "t" for a triplet (a "3"
  over the beam group), e.g. "8t". Read lengths from the stems, beams and
  flags below the TAB (no stem and a hollow head = 2 or 1); if there is no
  rhythm written, use the spacing and the time signature.
- content: notes played together joined by "+", each <string>-<fret>.
  Strings are the TAB lines, 1 = the top line (high E) to 6 = the bottom
  line (low E). The fret is the number written on the line, 0 to 24; "x"
  for a muted note; "(3)" for a fret in parentheses. "r" is a rest, "/" a
  slash or strum on the chord without frets written.
- after a note: h hammer-on (H), p pull-off (P), s slide (/ or \\) into the
  next note, b1 or b2 a bend by that many semitones (b0.5 for 1/4), v
  vibrato (~~), * harmonic (<12>), m palm mute (P.M.), l let ring; start a
  note with "~" when a tie arc joins it to the previous note on its string.
- marks: d for a down stroke arrow (↓ or ⊓), u for an up stroke (↑ or V),
  f for a fermata.
Example: "8:6-0+4-2!d 8:r 4:/!d 8t:1-0 8t:1-2h 8t:1-3 4:~1-3v". The lengths
of a measure should add up to its time signature (4/4: four quarters);
if they do not, write what is there and say so in the note. Skip measures
marked "repeat sign". When nothing is written on a measure's TAB (only
chord names), give an empty tab. Do not guess frets that cannot be read:
give an empty tab and say so in the note.

For each measure also give confidence (0 to 1) and, when something is
unclear, a short note (in the language of the score).

Reply with only JSON, no prose, in this shape (one entry per listed id, in
order):
{"measures": [
  {"id": "m1", "tab": "4:6-0+5-2+4-2!d 8:3-1 8:2-0 4:/!d 4:/!u", "confidence": 0.8},
  {"id": "m2", "tab": "", "confidence": 0.2, "note": "..."}
]}`;
}

export interface TabMeasureReading {
  id: string;
  beats: Beat[];
  /** Tokens that could not be read, with the reason. */
  invalid: string[];
  confidence?: number;
  note?: string;
}

export interface TabPageReading {
  measures: TabMeasureReading[];
  warnings: string[];
}

/** Check a tab answer (parsed JSON) for the measures `ids` asked for. */
export function parseTabReading(answer: unknown, ids: readonly string[]): TabPageReading {
  const warnings: string[] = [];
  const list = isObject(answer) && Array.isArray(answer.measures) ? answer.measures : Array.isArray(answer) ? answer : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of list) if (isObject(item) && typeof item.id === "string") byId.set(item.id, item);
  const readings: TabMeasureReading[] = [];
  for (const id of ids) {
    const raw = byId.get(id);
    if (!raw) {
      warnings.push(`${id}: no answer`);
      continue;
    }
    const { beats, invalid } = parseTabLine(typeof raw.tab === "string" ? raw.tab : "");
    for (const problem of invalid) warnings.push(`${id}: ${problem}`);
    const reading: TabMeasureReading = { id, beats, invalid };
    if (typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1) {
      reading.confidence = Math.round(raw.confidence * 100) / 100;
    }
    if (typeof raw.note === "string" && raw.note.trim()) reading.note = raw.note.trim();
    readings.push(reading);
  }
  return { measures: readings, warnings };
}

/**
 * Merge a tab reading: the measures' beats are replaced (an empty list
 * when nothing is written on the TAB; simile measures keep none) and their
 * review becomes "auto", or "needs-attention" when Claude was unsure, left
 * a note, part of the line could not be read or a check failed. A measure
 * already marked for review stays marked. Once every measure has been
 * read, "tab" is listed in meta.layers.
 */
export function applyTabReading(document: GtsDocument, reading: TabPageReading): GtsDocument {
  const doc: GtsDocument = structuredClone(document);
  const all = measures(doc);
  const index = new Map(all.map((m, i) => [m.id, i]));
  const signatures = timeSignatures(doc);
  for (const r of reading.measures) {
    const i = index.get(r.id);
    if (i === undefined) continue;
    const m = all[i]!;
    if (m.simile) continue;
    // An empty list: read, nothing written on the TAB (chords only).
    m.beats = r.beats;
    const previous = all[i - 1]?.beats?.at(-1);
    const problems = [
      ...(r.invalid.length ? [`読めない部分があります（${r.invalid.join("、")}）`] : []),
      ...checkTab(m, { timeSignature: signatures.get(m.id!)!, edge: i === 0 || i === all.length - 1, ...(previous ? { previous } : {}) }),
    ];
    // What chords/structure left unresolved stays; the same remark is not repeated on a re-read.
    const kept = m.review?.status === "needs-attention" ? (m.review.comment?.split("。") ?? []) : [];
    const comments = [...new Set([...kept, r.note, ...problems].filter((c): c is string => Boolean(c)))];
    const unsure = (r.confidence ?? 1) < ATTENTION_BELOW || r.note !== undefined || problems.length > 0;
    const confidence = Math.min(r.confidence ?? 1, m.review?.confidence ?? 1);
    m.review = { status: unsure || m.review?.status === "needs-attention" ? "needs-attention" : "auto" };
    if (r.confidence !== undefined) m.review.confidence = confidence;
    if (comments.length) m.review.comment = comments.join("。");
  }
  if (all.every((m) => m.simile || m.beats)) {
    const layers = new Set(doc.meta.layers ?? []);
    layers.add("tab");
    doc.meta.layers = (["layout", "structure", "chords", "tab", "lyrics"] as const).filter((l) => layers.has(l));
  }
  return doc;
}

/** Ids of measures whose tab is not read yet (simile measures need none). */
export function tabUnread(document: GtsDocument): string[] {
  return measures(document)
    .filter((m) => m.id && !m.simile && !m.beats)
    .map((m) => m.id!);
}

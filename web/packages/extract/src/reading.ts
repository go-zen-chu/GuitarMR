/**
 * Claude's answer for one page: checked field by field against the gts
 * rules (anything invalid is dropped and reported, never guessed), then
 * merged into the document as the structure and chords layers.
 */

import { CHORD_SYMBOL, type ChordEntry, type GtsDocument, measures } from "@guitarmr/gts";
import { STRUCTURE_FIELDS, rebuildSections, sectionStarts } from "./edit.ts";

const BAR_END = ["single", "double", "final", "repeat-end"] as const;
const NAVIGATION = ["segno", "coda", "to-coda", "ds", "ds-al-coda", "dc", "dc-al-coda", "fine"] as const;
const TIME_SIGNATURE = /^[0-9]{1,2}\/(1|2|4|8|16|32)$/;

/** Below this confidence a measure is marked for review. */
export const ATTENTION_BELOW = 0.7;

export interface MeasureReading {
  id: string;
  chords: ChordEntry[];
  section?: string;
  barStart?: "repeat-start";
  barEnd?: (typeof BAR_END)[number];
  repeatTimes?: number;
  volta?: number[];
  navigation?: (typeof NAVIGATION)[number][];
  simile?: 1 | 2;
  timeSignature?: string;
  confidence?: number;
  note?: string;
}

export interface HeaderReading {
  title?: string;
  artist?: string;
  key?: string;
  capo?: number;
  tempo?: number;
  beat?: 4 | 8 | 16;
  timeSignature?: string;
}

export interface PageReading {
  header?: HeaderReading;
  measures: MeasureReading[];
  /** What was dropped or missing, for the viewer. */
  warnings: string[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * Check an answer (already parsed JSON) for the measures `ids` asked for.
 * Unknown ids are ignored; a missing id yields no reading and a warning.
 */
export function parseReading(answer: unknown, ids: readonly string[]): PageReading {
  const warnings: string[] = [];
  const list = isObject(answer) && Array.isArray(answer.measures) ? answer.measures : Array.isArray(answer) ? answer : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of list) if (isObject(item) && typeof item.id === "string") byId.set(item.id, item);
  const readings: MeasureReading[] = [];
  for (const id of ids) {
    const raw = byId.get(id);
    if (!raw) {
      warnings.push(`${id}: no answer`);
      continue;
    }
    const drop = (field: string, value: unknown) => warnings.push(`${id}: ignored ${field} ${JSON.stringify(value)}`);
    const reading: MeasureReading = { id, chords: [] };
    if (Array.isArray(raw.chords)) {
      for (const c of raw.chords) {
        const symbol = isObject(c) ? text(c.symbol)?.replace(/\s+/g, "") : text(c);
        const beat = isObject(c) && typeof c.beat === "number" ? c.beat : 1;
        if (symbol && CHORD_SYMBOL.test(symbol) && beat >= 1 && beat < 17) reading.chords.push({ symbol, beat });
        else drop("chord", c);
      }
      reading.chords.sort((a, b) => (a.beat ?? 1) - (b.beat ?? 1));
    }
    const section = text(raw.section);
    if (section) reading.section = section;
    if (raw.barStart === "repeat-start") reading.barStart = "repeat-start";
    else if (raw.barStart !== undefined && raw.barStart !== null) drop("barStart", raw.barStart);
    if (BAR_END.includes(raw.barEnd as never)) {
      if (raw.barEnd !== "single") reading.barEnd = raw.barEnd as MeasureReading["barEnd"];
    } else if (raw.barEnd !== undefined && raw.barEnd !== null) drop("barEnd", raw.barEnd);
    if (Number.isInteger(raw.repeatTimes) && (raw.repeatTimes as number) >= 2 && reading.barEnd === "repeat-end") {
      reading.repeatTimes = raw.repeatTimes as number;
    }
    if (Array.isArray(raw.volta)) {
      const volta = raw.volta.filter((v): v is number => Number.isInteger(v) && v >= 1);
      if (volta.length) reading.volta = volta;
    }
    if (Array.isArray(raw.navigation)) {
      const navigation = raw.navigation.filter((n): n is (typeof NAVIGATION)[number] => NAVIGATION.includes(n as never));
      if (navigation.length) reading.navigation = [...new Set(navigation)];
      if (navigation.length < raw.navigation.length) drop("navigation", raw.navigation);
    }
    if (raw.simile === 1 || raw.simile === 2) reading.simile = raw.simile;
    if (typeof raw.timeSignature === "string" && TIME_SIGNATURE.test(raw.timeSignature)) {
      reading.timeSignature = raw.timeSignature;
    }
    if (typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1) {
      reading.confidence = Math.round(raw.confidence * 100) / 100;
    }
    const note = text(raw.note);
    if (note) reading.note = note;
    readings.push(reading);
  }
  const reading: PageReading = { measures: readings, warnings };
  if (isObject(answer) && isObject(answer.header)) {
    const h = answer.header;
    const header: HeaderReading = {};
    if (text(h.title)) header.title = text(h.title)!;
    if (text(h.artist)) header.artist = text(h.artist)!;
    if (text(h.key)) header.key = text(h.key)!;
    if (Number.isInteger(h.capo) && (h.capo as number) >= 0 && (h.capo as number) <= 12) header.capo = h.capo as number;
    if (typeof h.tempo === "number" && h.tempo > 0) header.tempo = h.tempo;
    if (h.beat === 4 || h.beat === 8 || h.beat === 16) header.beat = h.beat;
    if (typeof h.timeSignature === "string" && TIME_SIGNATURE.test(h.timeSignature)) {
      header.timeSignature = h.timeSignature;
    }
    if (Object.keys(header).length) reading.header = header;
  }
  return reading;
}

/**
 * Merge a page reading into the document (a new document is returned).
 * Read measures get their structure and chords replaced and an "auto"
 * review, or "needs-attention" when Claude was unsure or left a note.
 * Section starts are taken from the reading. Once every measure has been
 * read, the structure and chords layers are listed in meta.layers.
 */
export function applyReading(document: GtsDocument, reading: PageReading): GtsDocument {
  const doc: GtsDocument = structuredClone(document);
  const starts = sectionStarts(doc);
  const byId = new Map(measures(doc).map((m) => [m.id, m]));
  for (const r of reading.measures) {
    const m = byId.get(r.id);
    if (!m) continue;
    for (const field of STRUCTURE_FIELDS) delete m[field];
    if (r.barStart) m.barStart = r.barStart;
    if (r.barEnd) m.barEnd = r.barEnd;
    if (r.repeatTimes) m.repeatTimes = r.repeatTimes;
    if (r.volta) m.volta = r.volta as NonNullable<typeof m.volta>;
    if (r.navigation) m.navigation = r.navigation;
    if (r.simile) m.simile = r.simile;
    if (r.timeSignature) m.timeSignature = r.timeSignature;
    m.chords = r.chords;
    const unsure = (r.confidence ?? 1) < ATTENTION_BELOW || r.note !== undefined;
    m.review = { status: unsure ? "needs-attention" : "auto" };
    if (r.confidence !== undefined) m.review.confidence = r.confidence;
    if (r.note) m.review.comment = r.note;
    if (r.section) starts.set(r.id, r.section);
    else starts.delete(r.id);
  }
  if (reading.header) {
    const { title, ...rest } = reading.header;
    doc.meta = { ...doc.meta, ...rest, ...(title ? { title } : {}) };
  }
  const result = rebuildSections(doc, starts);
  if (measures(result).every((m) => m.review)) {
    const layers = new Set(result.meta.layers ?? []);
    layers.add("structure");
    layers.add("chords");
    result.meta.layers = (["layout", "structure", "chords", "tab", "lyrics"] as const).filter((l) => layers.has(l));
  }
  return result;
}

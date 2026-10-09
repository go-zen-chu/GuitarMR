/**
 * Edits made in the review screen, as pure functions returning a new
 * document. Sections are edited as "a section with this label starts at
 * this measure", so measures never move between pages or change ids.
 */

import { type GtsDocument, type Measure, type Section, measures } from "@guitarmr/gts";

/** Measure fields owned by the structure and chords layers. */
export const STRUCTURE_FIELDS = [
  "barStart",
  "barEnd",
  "repeatTimes",
  "volta",
  "navigation",
  "simile",
  "timeSignature",
  "chords",
] as const satisfies readonly (keyof Measure)[];

/** Measure id → label of the section starting there. */
export function sectionStarts(document: GtsDocument): Map<string, string> {
  const starts = new Map<string, string>();
  for (const s of document.sections) {
    const first = s.measures[0];
    if (s.label && first?.id) starts.set(first.id, s.label);
  }
  return starts;
}

/** Regroup all measures into sections starting at the given labels. */
export function rebuildSections(document: GtsDocument, starts: ReadonlyMap<string, string>): GtsDocument {
  const sections: Section[] = [];
  for (const m of measures(document)) {
    const label = m.id ? starts.get(m.id) : undefined;
    if (label || sections.length === 0) sections.push(label ? { label, measures: [] } : { measures: [] });
    sections[sections.length - 1]!.measures.push(m);
  }
  return { ...document, sections: sections as GtsDocument["sections"] };
}

/**
 * Change one measure: fields set to undefined (or an empty list) are
 * removed. A simile measure keeps no beats of its own (it repeats the
 * previous measure's rhythm and notes); its chords stay.
 */
export function updateMeasure(document: GtsDocument, id: string, patch: Partial<Measure>): GtsDocument {
  const doc: GtsDocument = structuredClone(document);
  const m = measures(doc).find((x) => x.id === id);
  if (!m) throw new Error(`no measure ${id}`);
  for (const [key, value] of Object.entries(patch) as [keyof Measure, unknown][]) {
    if (value === undefined || (Array.isArray(value) && value.length === 0 && key !== "chords")) delete m[key];
    else (m as Record<string, unknown>)[key] = value;
  }
  if (m.simile) delete m.beats;
  return doc;
}

/** Start (label) or stop (undefined) a section at a measure. */
export function setSectionStart(document: GtsDocument, id: string, label: string | undefined): GtsDocument {
  const starts = sectionStarts(document);
  if (label?.trim()) starts.set(id, label.trim());
  else starts.delete(id);
  return rebuildSections(structuredClone(document), starts);
}

export interface ReviewSummary {
  total: number;
  unread: number;
  auto: number;
  attention: number;
  reviewed: number;
}

export function reviewSummary(document: GtsDocument): ReviewSummary {
  const summary: ReviewSummary = { total: 0, unread: 0, auto: 0, attention: 0, reviewed: 0 };
  for (const m of measures(document)) {
    summary.total++;
    const status = m.review?.status;
    if (status === "reviewed") summary.reviewed++;
    else if (status === "needs-attention") summary.attention++;
    else if (status === "auto") summary.auto++;
    else summary.unread++;
  }
  return summary;
}

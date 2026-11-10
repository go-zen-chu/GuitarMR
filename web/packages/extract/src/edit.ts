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
    // Empty chords and beats are kept: read, nothing written there.
    if (value === undefined || (Array.isArray(value) && value.length === 0 && key !== "chords" && key !== "beats")) delete m[key];
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

// ---------------------------------------------------------------------------
// Fixing what detection got wrong: measures merged or split by mistake, and
// pages that are not part of the score (a chord chart, a cover).

/** Measure fields that describe what was read inside it; they no longer hold once its region changes. */
const CONTENT_FIELDS = ["chords", "beats", "lyrics", "simile", "review"] as const satisfies readonly (keyof Measure)[];

/** Narrowest part a split may leave, as a share of the measure's width. */
export const MIN_SPLIT_SHARE = 0.08;

/** Ids m1, m2, ... in written order again, after measures were added or removed. */
export function renumber(document: GtsDocument): GtsDocument {
  let n = 0;
  return {
    ...document,
    sections: document.sections.map((s) => ({
      ...s,
      measures: s.measures.map((m) => ({ ...m, id: `m${++n}` })),
    })) as GtsDocument["sections"],
  };
}

/** The document with each measure replaced by what `change` returns for it (none: removed). */
function rewrite(document: GtsDocument, change: (m: Measure) => Measure[]): GtsDocument {
  const sections = structuredClone(document.sections)
    .map((s) => ({ ...s, measures: s.measures.flatMap(change) }))
    .filter((s) => s.measures.length > 0);
  if (sections.length === 0) throw new Error("every measure would be removed");
  return renumber({ ...document, sections: sections as GtsDocument["sections"] });
}

function withoutContent(m: Measure): Measure {
  const out = { ...m };
  for (const key of CONTENT_FIELDS) delete out[key];
  return out;
}

/** Remove measures that are not measures (e.g. a box around a title). */
export function deleteMeasures(document: GtsDocument, ids: readonly string[]): GtsDocument {
  const doomed = new Set(ids);
  return rewrite(document, (m) => (m.id && doomed.has(m.id) ? [] : [m]));
}

/**
 * Split a measure in two at page x (normalized 0..1), for a bar line that
 * detection missed. The left part keeps how the measure starts, the right
 * part how it ends; what was read inside it is dropped, so both are read
 * again.
 */
export function splitMeasure(document: GtsDocument, id: string, x: number): GtsDocument {
  return rewrite(document, (m) => {
    if (m.id !== id) return [m];
    if (!m.region) throw new Error(`${id} has no region`);
    const [x0, y0, x1, y1] = m.region.bbox as [number, number, number, number];
    const margin = MIN_SPLIT_SHARE * (x1 - x0);
    if (!(x > x0 + margin && x < x1 - margin)) throw new Error(`x ${x} is not inside ${id}`);
    const cut = Math.round(x * 10000) / 10000;
    const { barEnd, repeatTimes, ...rest } = withoutContent(m);
    const left: Measure = { ...rest, region: { ...m.region, bbox: [x0, y0, cut, y1] } };
    const right: Measure = {
      id: `${id}b`,
      region: { ...m.region, bbox: [cut, y0, x1, y1] },
      ...(barEnd ? { barEnd } : {}),
      ...(repeatTimes ? { repeatTimes } : {}),
    };
    return [left, right];
  });
}

/** The measure after `id` when both sit side by side in one system, else undefined. */
export function nextInSystem(document: GtsDocument, id: string): Measure | undefined {
  const all = measures(document);
  const i = all.findIndex((m) => m.id === id);
  const a = all[i]?.region;
  const b = all[i + 1]?.region;
  if (!a || !b || a.page !== b.page) return undefined;
  const sameBand = Math.abs(a.bbox[1]! - b.bbox[1]!) < 1e-3 && Math.abs(a.bbox[3]! - b.bbox[3]!) < 1e-3;
  return sameBand && b.bbox[0]! >= a.bbox[0]! ? all[i + 1] : undefined;
}

/**
 * Join a measure with the next one in its system, for a stroke taken for a
 * bar line (e.g. an oval around a chord). The joined measure starts like
 * the first and ends like the second; what was read inside them is dropped.
 */
export function mergeWithNext(document: GtsDocument, id: string): GtsDocument {
  const next = nextInSystem(document, id);
  if (!next) throw new Error(`${id} has no next measure in its system`);
  const first = measures(document).find((m) => m.id === id)!;
  const [x0, y0] = first.region!.bbox as [number, number, number, number];
  const [, , x1, y1] = next.region!.bbox as [number, number, number, number];
  const joined = withoutContent(first);
  joined.region = { page: first.region!.page, bbox: [x0, y0, x1, y1] };
  delete joined.barEnd;
  delete joined.repeatTimes;
  delete joined.navigation;
  if (next.barEnd) joined.barEnd = next.barEnd;
  if (next.repeatTimes) joined.repeatTimes = next.repeatTimes;
  const navigation = [...new Set([...(first.navigation ?? []), ...(next.navigation ?? [])])];
  if (navigation.length) joined.navigation = navigation as NonNullable<Measure["navigation"]>;
  return rewrite(document, (m) => (m.id === id ? [joined] : m.id === next.id ? [] : [m]));
}

/** Leave a page out of the score: its measures go, and so does the page from the source list. */
export function removePage(document: GtsDocument, page: number): GtsDocument {
  const doc = rewrite(document, (m) => (m.region?.page === page ? [] : [m]));
  return { ...doc, source: { ...doc.source, pages: doc.source.pages.filter((p) => p.index !== page) as GtsDocument["source"]["pages"] } };
}

/**
 * Bring a page left out by removePage back, with the measures detection
 * found on it (from `detected`, the layout-only document), in page order.
 */
export function restorePage(document: GtsDocument, detected: GtsDocument, page: number): GtsDocument {
  const back = structuredClone(measures(detected).filter((m) => m.region?.page === page));
  const source = detected.source.pages.find((p) => p.index === page);
  if (back.length === 0 || !source) throw new Error(`page ${page} has no detected measures`);
  if (measures(document).some((m) => m.region?.page === page)) return document;
  const sections = structuredClone(document.sections);
  // Before the first measure of a later page, else at the end.
  const later = (m: Measure) => (m.region?.page ?? -1) > page;
  const found = sections.findIndex((s) => s.measures.some(later));
  const target = sections[found < 0 ? sections.length - 1 : found]!.measures;
  target.splice(found < 0 ? target.length : target.findIndex(later), 0, ...back);
  const pages = [...document.source.pages.filter((p) => p.index !== page), source].sort((a, b) => a.index - b.index);
  return renumber({
    ...document,
    source: { ...document.source, pages: pages as GtsDocument["source"]["pages"] },
    sections: sections as GtsDocument["sections"],
  });
}

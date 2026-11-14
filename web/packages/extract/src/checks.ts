/**
 * Checks of what was read, beyond the schema: inside a measure, that the
 * tab's beats fill its time signature and its notes can be played; across
 * measures, that repeats close, endings follow a repeat, D.S./D.C. find
 * their signs and sections start in sensible places; and that no measure
 * is far wider or narrower than the others, a sign that the scan missed a
 * bar line or took something else for one. A check never
 * changes the document; the reader marks measures with tab problems for
 * review, the page lists the rest. Messages are for the person reviewing,
 * in Japanese like the page.
 */

import { type Beat, type GtsDocument, type Measure, MAX_STEPS, measureLength, measures, playOrder } from "@guitarmr/gts";

export type IssueKind = "tab" | "repeat" | "volta" | "navigation" | "section" | "simile" | "width";

export interface Issue {
  kind: IssueKind;
  /** The measures involved, the first one is where to look. */
  ids: string[];
  message: string;
}

/** Widest stretch between fretted notes of one chord that a hand can hold. */
export const MAX_STRETCH = 5;

/** Time signature in force at every measure (written order), "4/4" by default. */
export function timeSignatures(document: GtsDocument): Map<string, string> {
  const out = new Map<string, string>();
  let current = document.meta.timeSignature ?? "4/4";
  for (const m of measures(document)) {
    if (m.timeSignature) current = m.timeSignature;
    if (m.id) out.set(m.id, current);
  }
  return out;
}

/** A whole-note fraction as beats of the time signature, e.g. "3.5". */
function inBeats([num, den]: [number, number], timeSignature: string): string {
  const unit = Number(timeSignature.split("/")[1]) || 4;
  return String(Math.round(((num * unit) / den) * 100) / 100);
}

export interface TabContext {
  timeSignature: string;
  /** First or last measure of the score: may be a pickup or its rest, so shorter is fine. */
  edge: boolean;
  /** The last beat of the measure written before, for ties into this one. */
  previous?: Beat;
}

/** Problems with one measure's tab (its beats). Empty when it has none or all is well. */
export function checkTab(measure: Measure, context: TabContext): string[] {
  const beats = measure.beats ?? [];
  if (!beats.length) return [];
  const problems: string[] = [];
  const [n, d] = context.timeSignature.split("/").map(Number) as [number, number];
  const [num, den] = measureLength(measure);
  // Compare num/den with n/d without floating point.
  const diff = num * d - n * den;
  if (diff > 0) {
    problems.push(`拍が多すぎます（${context.timeSignature} に ${inBeats([num, den], context.timeSignature)} 拍）`);
  } else if (diff < 0 && !context.edge) {
    problems.push(`拍が足りません（${context.timeSignature} に ${inBeats([num, den], context.timeSignature)} 拍）`);
  }
  let before = context.previous;
  beats.forEach((beat, i) => {
    const where = beats.length > 1 ? `${i + 1}つ目の音: ` : "";
    const notes = beat.notes ?? [];
    const strings = notes.map((x) => x.string);
    const twice = strings.filter((s, k) => strings.indexOf(s) !== k);
    if (twice.length) problems.push(`${where}${[...new Set(twice)].join("・")}弦に音が2つあります`);
    const frets = notes.filter((x) => !x.dead && (x.fret ?? 0) > 0).map((x) => x.fret!);
    if (frets.length > 1 && Math.max(...frets) - Math.min(...frets) > MAX_STRETCH) {
      problems.push(`${where}${Math.min(...frets)}〜${Math.max(...frets)} フレットを同時に押さえることになります`);
    }
    for (const note of notes.filter((x) => x.tie)) {
      const from = before?.notes?.find((x) => x.string === note.string);
      if (!from) problems.push(`${where}${note.string}弦のタイの前に同じ弦の音がありません`);
      else if (from.fret !== note.fret) problems.push(`${where}${note.string}弦のタイが違うフレット（${from.fret} → ${note.fret}）につながっています`);
    }
    before = beat;
  });
  return problems;
}

/** Tab problems of every measure, by measure id (measures without problems are left out). */
export function checkAllTabs(document: GtsDocument): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const signatures = timeSignatures(document);
  const all = measures(document);
  all.forEach((m, i) => {
    if (!m.id) return;
    const previous = all[i - 1]?.beats?.at(-1);
    const problems = checkTab(m, {
      timeSignature: signatures.get(m.id)!,
      edge: i === 0 || i === all.length - 1,
      ...(previous ? { previous } : {}),
    });
    if (problems.length) out.set(m.id, problems);
  });
  return out;
}

const has = (m: Measure, nav: string) => m.navigation?.includes(nav as never) ?? false;

/** Problems across measures: repeats, endings, D.S./D.C., similes and sections, in written order. */
export function checkStructure(document: GtsDocument): Issue[] {
  const issues: Issue[] = [];
  const all = measures(document).filter((m): m is Measure & { id: string } => Boolean(m.id));
  const add = (kind: IssueKind, ids: string[], message: string) => issues.push({ kind, ids, message });

  // Repeats: every ‖: is closed by a :‖ before the next ‖:.
  let open: string | null = null;
  let closedOnce = false;
  for (const m of all) {
    if (m.barStart === "repeat-start") {
      if (open) add("repeat", [open, m.id], `${open} のリピート開始 ‖: が閉じないまま、${m.id} で次のリピートが始まっています`);
      open = m.id;
    }
    if (m.barEnd === "repeat-end") {
      // Without a ‖: the repeat goes back to the beginning: fine for the first one only.
      if (!open && closedOnce) add("repeat", [m.id], `${m.id} のリピート終了 :‖ に対応するリピート開始 ‖: がありません（曲の頭に戻ります）`);
      open = null;
      closedOnce = true;
    }
    if (m.repeatTimes && m.barEnd !== "repeat-end") add("repeat", [m.id], `${m.id} に演奏回数がありますが、リピート終了 :‖ ではありません`);
  }
  if (open) add("repeat", [open], `${open} のリピート開始 ‖: が最後まで閉じていません`);

  // Endings: groups of consecutive bracketed measures.
  for (let i = 0; i < all.length; ) {
    if (!all[i]!.volta) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < all.length && all[j + 1]!.volta) j++;
    const group = all.slice(i, j + 1);
    const ids = group.map((m) => m.id);
    const numbers = [...new Set(group.flatMap((m) => m.volta ?? []))].sort((a, b) => a - b);
    if (numbers.some((v, k) => v !== k + 1)) {
      add("volta", ids, `${ids[0]} からの番カッコの番号が 1 から順に並んでいません（${numbers.join(", ")}）`);
    }
    const last = Math.max(...numbers);
    // Every ending but the last ends by going back: its last measure has :‖.
    const ends = new Set<string>();
    for (const v of numbers.filter((v) => v < last)) {
      const span = group.filter((m) => m.volta!.includes(v));
      const end = span[span.length - 1]!;
      if (ends.has(end.id)) continue; // "1.2." share their last measure
      ends.add(end.id);
      if (end.barEnd !== "repeat-end") add("volta", [end.id], `${v}番カッコの終わり（${end.id}）にリピート終了 :‖ がありません`);
      else if ((end.repeatTimes ?? 2) < Math.max(...end.volta!) + 1) {
        const times = end.repeatTimes ?? 2;
        add("volta", [end.id], `番カッコは ${last} 番までありますが、${end.id} のリピートは ${times} 回です`);
      }
    }
    if (last > 1 && !group.some((m) => m.barEnd === "repeat-end")) {
      add("volta", ids, `${ids[0]} からの番カッコの間にリピート終了 :‖ がありません`);
    }
    const label = document.sections.find((s) => s.label && ids.slice(1).includes(s.measures[0]?.id ?? ""));
    if (label) add("section", [label.measures[0]!.id!], `セクション「${label.label}」が番カッコの途中から始まっています`);
    i = j + 1;
  }

  // D.S. / D.C. with Coda and Fine.
  const find = (nav: string) => all.filter((m) => has(m, nav)).map((m) => m.id);
  const segno = find("segno");
  const toCoda = find("to-coda");
  const coda = find("coda");
  const alCoda = [...find("ds-al-coda"), ...find("dc-al-coda")];
  const jumps = [...find("ds"), ...find("dc"), ...alCoda];
  for (const id of [...find("ds"), ...find("ds-al-coda")]) {
    if (!segno.length) add("navigation", [id], `${id} の D.S. で戻る先のセーニョ 𝄋 がありません`);
  }
  for (const id of alCoda) {
    if (!toCoda.length) add("navigation", [id], `${id} は al Coda ですが、To Coda がありません`);
    if (!coda.length) add("navigation", [id], `${id} は al Coda ですが、飛ぶ先のコーダ 𝄌 がありません`);
  }
  const index = (id: string) => all.findIndex((m) => m.id === id);
  if (toCoda.length && coda.length && index(coda[coda.length - 1]!) < index(toCoda[0]!)) {
    add("navigation", [coda[0]!], `コーダ 𝄌（${coda[0]}）が To Coda（${toCoda[0]}）より前にあります`);
  }
  if (toCoda.length && !alCoda.length) add("navigation", [toCoda[0]!], `${toCoda[0]} に To Coda がありますが、D.S. al Coda / D.C. al Coda がありません`);
  if (coda.length && !toCoda.length) add("navigation", [coda[0]!], `${coda[0]} にコーダ 𝄌 がありますが、To Coda がありません`);
  for (const id of find("fine")) {
    if (!jumps.length) add("navigation", [id], `${id} に Fine がありますが、D.S. / D.C. がありません`);
  }
  if (jumps.length > 1) add("navigation", jumps, `D.S. / D.C. が ${jumps.length} か所にあります（最初のものだけが使われます）`);

  // Similes repeat measures that exist and have something to repeat.
  all.forEach((m, i) => {
    if (!m.simile) return;
    if (i < m.simile) add("simile", [m.id], `${m.id} の繰り返し記号の前に、繰り返す ${m.simile} 小節がありません`);
    if (m.beats?.length) add("simile", [m.id], `${m.id} は繰り返し記号の小節ですが、TAB も書かれています`);
  });

  // Sections: once some are named, the first one should be too.
  const [first, ...rest] = document.sections;
  if (first && !first.label && rest.some((s) => s.label) && first.measures[0]?.id) {
    add("section", [first.measures[0].id], `最初のセクション（${first.measures[0].id} から）に名前がありません（ほかは名前付き）`);
  }

  if (playOrder(document).length >= MAX_STEPS) add("repeat", [all[0]?.id ?? ""], "繰り返しが終わらず、演奏順を最後までたどれません");
  return issues;
}

/**
 * Widths against the score's typical measure, as shares of it: hand-drawn
 * measures vary, but one twice as wide holds two (a missed bar line), and
 * one a third as wide is rarely a measure (a stem or a stroke taken for a
 * bar line). Short measures at the end of a line are common, so only very
 * narrow ones count.
 */
export const WIDTH_LIMITS = { wide: 1.7, narrow: 0.4 };

/** Fewer measures than this tell too little about the typical width. */
const MIN_MEASURES_FOR_WIDTH = 4;

/**
 * Measures far wider or narrower than the score's typical (median) one,
 * left out once the person reviewed them. Widths are shares of the page
 * (regions are normalized), so pages of one score compare.
 */
export function checkWidths(document: GtsDocument): Issue[] {
  const placed = measures(document).filter((m) => m.id && m.region);
  if (placed.length < MIN_MEASURES_FOR_WIDTH) return [];
  const width = (m: Measure) => m.region!.bbox[2]! - m.region!.bbox[0]!;
  const sorted = placed.map(width).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)]!;
  if (!(typical > 0)) return [];
  const issues: Issue[] = [];
  for (const m of placed) {
    if (m.review?.status === "reviewed") continue;
    const share = width(m) / typical;
    const times = share.toFixed(1);
    if (share >= WIDTH_LIMITS.wide) {
      issues.push({ kind: "width", ids: [m.id!], message: `${m.id}: ほかの小節の約 ${times} 倍の幅です。小節線を見落としていたら「2つに分ける」で分けてください` });
    } else if (share <= WIDTH_LIMITS.narrow) {
      issues.push({
        kind: "width",
        ids: [m.id!],
        message: `${m.id}: ほかの小節の約 ${times} 倍の幅しかありません。余分な小節線なら「次の小節とつなげる」、小節でなければ「この小節を消す」で直してください`,
      });
    }
  }
  return issues;
}

/** Every issue: the structure checks, the measure widths, then the tab problems of each measure. */
export function checkDocument(document: GtsDocument): Issue[] {
  const tab = [...checkAllTabs(document)].flatMap(([id, problems]) =>
    problems.map((message): Issue => ({ kind: "tab", ids: [id], message: `${id}: ${message}` })),
  );
  return [...checkStructure(document), ...checkWidths(document), ...tab];
}


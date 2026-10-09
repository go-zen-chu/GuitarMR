/**
 * The measure editor: a bottom sheet showing the selected measure cut out
 * of the page, with its chords, section start, bar lines and signs. Each
 * field applies when it is changed; "確認済みにして次へ" marks the measure
 * reviewed and moves on.
 */

import { type GtsDocument, type Measure, beatsPerBar, formatChordLine, measures, parseChordLine } from "@guitarmr/gts";
import { setSectionStart, updateMeasure } from "@guitarmr/extract";
import { STATUS_LABEL, sectionLabels, statusOf } from "./score-view.ts";

export interface EditorHost {
  doc(): GtsDocument;
  /** The upright page image: object URL and size in pixels. */
  pageImage(page: number): { url: string; width: number; height: number } | undefined;
  commit(doc: GtsDocument): void;
  select(id: string | null): void;
}

const NAV_IDS = ["segno", "coda", "to-coda", "ds", "ds-al-coda", "dc", "dc-al-coda", "fine"] as const;

export function createEditor(host: EditorHost) {
  const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
  const f = {
    sheet: $<HTMLElement>("sheet"),
    title: $<HTMLElement>("sheet-title"),
    status: $<HTMLElement>("sheet-status"),
    crop: $<HTMLElement>("sheet-crop"),
    note: $<HTMLElement>("sheet-note"),
    chords: $<HTMLInputElement>("f-chords"),
    chordsError: $<HTMLElement>("f-chords-error"),
    section: $<HTMLInputElement>("f-section"),
    more: $<HTMLDetailsElement>("f-more"),
    repeatStart: $<HTMLInputElement>("f-repeat-start"),
    barEnd: $<HTMLSelectElement>("f-bar-end"),
    repeatTimes: $<HTMLInputElement>("f-repeat-times"),
    volta: $<HTMLInputElement>("f-volta"),
    simile: $<HTMLSelectElement>("f-simile"),
    nav: Object.fromEntries(NAV_IDS.map((n) => [n, $<HTMLInputElement>(`f-nav-${n}`)])) as Record<string, HTMLInputElement>,
  };
  let currentId: string | null = null;

  const measure = (): Measure | undefined => measures(host.doc()).find((m) => m.id === currentId);
  const perBar = (m: Measure) => beatsPerBar(m.timeSignature ?? host.doc().meta.timeSignature);
  const apply = (patch: Partial<Measure>) => {
    if (currentId) host.commit(updateMeasure(host.doc(), currentId, patch));
  };

  function fill() {
    const m = measure();
    if (!m || !m.id) return close();
    const status = statusOf(m);
    f.title.textContent = `${m.id}（p${(m.region?.page ?? 0) + 1}）`;
    f.status.textContent = STATUS_LABEL[status];
    f.status.className = `chip s-${status}`;
    const image = m.region ? host.pageImage(m.region.page) : undefined;
    f.crop.hidden = !image || !m.region;
    if (image && m.region) {
      // Show the measure's band as a window onto the page image.
      const [x0, y0, x1, y1] = m.region.bbox as number[] as [number, number, number, number];
      const w = x1 - x0;
      const h = y1 - y0;
      f.crop.style.backgroundImage = `url("${image.url}")`;
      f.crop.style.backgroundSize = `${100 / w}% ${100 / h}%`;
      f.crop.style.backgroundPosition = `${w < 1 ? (x0 / (1 - w)) * 100 : 0}% ${h < 1 ? (y0 / (1 - h)) * 100 : 0}%`;
      f.crop.style.setProperty("--aspect", String((w * image.width) / (h * image.height)));
    }
    f.note.hidden = !m.review?.comment;
    f.note.textContent = m.review?.comment ? `AIのメモ: ${m.review.comment}` : "";
    f.chords.value = formatChordLine(m.chords, perBar(m));
    f.chordsError.textContent = "";
    f.section.value = sectionLabels(host.doc()).get(m.id) ?? "";
    f.repeatStart.checked = m.barStart === "repeat-start";
    f.barEnd.value = m.barEnd && m.barEnd !== "single" ? m.barEnd : "";
    f.repeatTimes.value = m.repeatTimes ? String(m.repeatTimes) : "";
    f.repeatTimes.disabled = m.barEnd !== "repeat-end";
    f.volta.value = m.volta?.join(",") ?? "";
    f.simile.value = m.simile ? String(m.simile) : "";
    for (const n of NAV_IDS) f.nav[n]!.checked = m.navigation?.includes(n) ?? false;
    const marked = Boolean(m.barStart || (m.barEnd && m.barEnd !== "single") || m.volta || m.simile || m.navigation?.length);
    if (marked) f.more.open = true;
  }

  function open(id: string) {
    currentId = id;
    f.sheet.hidden = false;
    document.body.classList.add("editing");
    host.select(id);
    fill();
  }

  function close() {
    currentId = null;
    f.sheet.hidden = true;
    document.body.classList.remove("editing");
    host.select(null);
  }

  function step(delta: number) {
    const ids = measures(host.doc()).map((m) => m.id!);
    const i = currentId ? ids.indexOf(currentId) : -1;
    const next = ids[i + delta];
    if (next) open(next);
    else close();
  }

  f.chords.addEventListener("change", () => {
    const m = measure();
    if (!m) return;
    const { chords, invalid } = parseChordLine(f.chords.value, perBar(m));
    f.chordsError.textContent = invalid.length
      ? `${invalid.map((t) => `「${t}」`).join("")}をコードとして読めません（拍は 1〜${perBar(m)}）。直してください。`
      : "";
    if (!invalid.length) apply({ chords });
  });
  f.section.addEventListener("change", () => {
    if (currentId) host.commit(setSectionStart(host.doc(), currentId, f.section.value));
  });
  f.repeatStart.addEventListener("change", () => apply({ barStart: f.repeatStart.checked ? "repeat-start" : undefined }));
  f.barEnd.addEventListener("change", () => {
    const value = f.barEnd.value as Measure["barEnd"] | "";
    apply({ barEnd: value || undefined, ...(value === "repeat-end" ? {} : { repeatTimes: undefined }) });
  });
  f.repeatTimes.addEventListener("change", () => {
    const n = Number(f.repeatTimes.value);
    apply({ repeatTimes: Number.isInteger(n) && n >= 2 ? n : undefined });
  });
  f.volta.addEventListener("change", () => {
    const numbers = f.volta.value
      .split(/[\s,、]+/)
      .map(Number)
      .filter((n) => Number.isInteger(n) && n >= 1);
    apply({ volta: numbers.length ? (numbers as NonNullable<Measure["volta"]>) : undefined });
  });
  f.simile.addEventListener("change", () => {
    const value = Number(f.simile.value);
    apply({ simile: value === 1 || value === 2 ? value : undefined });
  });
  for (const n of NAV_IDS) {
    f.nav[n]!.addEventListener("change", () =>
      apply({ navigation: NAV_IDS.filter((x) => f.nav[x]!.checked) as NonNullable<Measure["navigation"]> }),
    );
  }
  $("sheet-close").addEventListener("click", close);
  $("sheet-prev").addEventListener("click", () => step(-1));
  $("sheet-next").addEventListener("click", () => step(1));
  $("sheet-ok").addEventListener("click", () => {
    // A pending edit in the chord field counts too (iOS may not fire change first).
    f.chords.dispatchEvent(new Event("change"));
    if (f.chordsError.textContent) return;
    const m = measure();
    if (m) apply({ review: { status: "reviewed", ...(m.review?.confidence !== undefined ? { confidence: m.review.confidence } : {}) } });
    step(1);
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && currentId) close();
  });

  return {
    open,
    close,
    /** Re-read the fields after the document changed elsewhere. */
    refresh: () => currentId && fill(),
    current: () => currentId,
  };
}

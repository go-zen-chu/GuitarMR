/**
 * The score view: each page is a JPEG of the upright page with an SVG
 * layer on top drawn from the gts document, so it shows the same thing for
 * a fresh scan, after Claude has read it, and for a loaded gts file. Every
 * measure is a button that opens the editor.
 */

import { type GtsDocument, type Measure, formatChordLine, beatsPerBar, measures } from "@guitarmr/gts";
import { type PageLayout, systemBottom, systemLeft, systemRight, systemTop } from "@guitarmr/layoutscan";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface PageView {
  index: number;
  /** Size of the preview image in pixels (the SVG viewBox). */
  width: number;
  height: number;
  /** Preview pixels per layout pixel. */
  scale: number;
  layout: PageLayout;
  image: Blob;
  url: string;
  svg: SVGSVGElement;
}

export type MeasureStatus = "unread" | "auto" | "attention" | "reviewed";

export function statusOf(m: Measure): MeasureStatus {
  switch (m.review?.status) {
    case "reviewed":
      return "reviewed";
    case "needs-attention":
      return "attention";
    case "auto":
      return "auto";
    default:
      return "unread";
  }
}

export const STATUS_LABEL: Record<MeasureStatus, string> = {
  unread: "未読",
  auto: "AI",
  attention: "要確認",
  reviewed: "確認済み",
};

const NAV_TEXT: Record<string, string> = {
  segno: "𝄋",
  coda: "𝄌",
  "to-coda": "To𝄌",
  ds: "D.S.",
  "ds-al-coda": "D.S.al𝄌",
  dc: "D.C.",
  "dc-al-coda": "D.C.al𝄌",
  fine: "Fine",
};

/** One line summing up what was read for a measure, e.g. "[A] ‖: Am E7 :‖×2". */
export function measureLine(m: Measure, section?: string, timeSignature?: string): string {
  const parts: string[] = [];
  if (section) parts.push(`[${section}]`);
  if (m.timeSignature) parts.push(m.timeSignature);
  if (m.volta) parts.push(`${m.volta.join(",")}.`);
  if (m.barStart) parts.push("‖:");
  if (m.simile) parts.push(m.simile === 1 ? "%" : "%%");
  const chords = formatChordLine(m.chords, beatsPerBar(m.timeSignature ?? timeSignature));
  if (chords) parts.push(chords);
  for (const n of m.navigation ?? []) parts.push(NAV_TEXT[n] ?? n);
  if (m.barEnd === "repeat-end") parts.push(m.repeatTimes ? `:‖×${m.repeatTimes}` : ":‖");
  else if (m.barEnd === "double") parts.push("‖");
  else if (m.barEnd === "final") parts.push("‖.");
  return parts.join(" ");
}

function el<K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Labels of sections by the id of their first measure. */
export function sectionLabels(doc: GtsDocument): Map<string, string> {
  const labels = new Map<string, string>();
  for (const s of doc.sections) if (s.label && s.measures[0]?.id) labels.set(s.measures[0].id, s.label);
  return labels;
}

/** Redraw the SVG layer of one page. */
export function drawPage(view: PageView, doc: GtsDocument, selected: string | null): void {
  const { svg, width: W, height: H, scale } = view;
  svg.replaceChildren();
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  for (const s of view.layout.systems) {
    const top = systemTop(s) * scale;
    svg.append(
      el("rect", {
        class: "system",
        x: systemLeft(s) * scale,
        y: top,
        width: (systemRight(s) - systemLeft(s)) * scale,
        height: systemBottom(s) * scale - top,
      }),
    );
  }
  const labels = sectionLabels(doc);
  const font = Math.round(W / 42);
  for (const m of measures(doc)) {
    if (!m.region || m.region.page !== view.index || !m.id) continue;
    const [x0, y0, x1, y1] = m.region.bbox as number[] as [number, number, number, number];
    const status = statusOf(m);
    const g = el("g", {
      class: `measure s-${status}${m.id === selected ? " selected" : ""}`,
      "data-id": m.id,
      tabindex: 0,
      role: "button",
    });
    const line = measureLine(m, labels.get(m.id), doc.meta.timeSignature);
    g.setAttribute("aria-label", `${m.id} ${STATUS_LABEL[status]} ${line}`);
    const inset = W / 400;
    g.append(el("rect", { class: "box", x: x0 * W + inset, y: y0 * H, width: (x1 - x0) * W - 2 * inset, height: (y1 - y0) * H }));
    const num = el("text", { class: "num", x: x0 * W + 2 * inset, y: y0 * H + font * 0.9, "font-size": font * 0.8 });
    num.textContent = m.id.replace(/^m/, "");
    g.append(num);
    if (line) {
      const text = el("text", { class: "line", x: x0 * W + 2 * inset, y: y0 * H + font * 1.9, "font-size": font });
      text.textContent = line;
      g.append(text);
    }
    svg.append(g);
    // Squeeze a long line into its measure (needs the SVG to be on the page).
    const text = g.querySelector<SVGTextElement>("text.line");
    const room = (x1 - x0) * W - 4 * inset;
    if (text && text.getComputedTextLength() > room) {
      text.setAttribute("textLength", String(room));
      text.setAttribute("lengthAdjust", "spacingAndGlyphs");
    }
  }
}

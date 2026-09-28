/** Build the `layout` layer of a gts document from detected page layouts. */

import type { GtsDocument, Measure } from "@guitarmr/gts";
import {
  type PageLayout,
  type System,
  measureSpans,
  staffBottomAt,
  staffTopAt,
  systemBottom,
  systemLeft,
  systemRight,
  systemSpacing,
  systemTop,
} from "./detect.ts";

export interface ScannedPage {
  index: number; // 0-based page index in the PDF
  layout: PageLayout;
}

/**
 * Share of the gap between two systems given to the upper one. Chord names
 * sit just above their own system, while the space right below a system
 * holds its rhythm, stroke arrows and lyrics, which take less room.
 */
export const UPPER_SHARE = 0.35;

/**
 * Vertical band [y0, y1] owned by each system, top to bottom. Each gap
 * between two systems is split between them (see UPPER_SHARE), so a band
 * also holds the chord names above and the rhythm/lyrics below its staves.
 * The outer edges of the first and last systems mirror their inner gap.
 */
export function systemBands(systems: System[], pageHeight: number): [number, number][] {
  if (systems.length === 0) return [];
  const topOf = (s: System): number => {
    const top = s.staff ?? s.tab;
    return Math.min(staffTopAt(top, systemLeft(s)), staffTopAt(top, systemRight(s)), systemTop(s));
  };
  const bottomOf = (s: System): number =>
    Math.max(staffBottomAt(s.tab, systemLeft(s)), staffBottomAt(s.tab, systemRight(s)), systemBottom(s));
  const tops = systems.map(topOf);
  const bottoms = systems.map(bottomOf);
  let gaps = systems.slice(1).map((_, i) => tops[i + 1]! - bottoms[i]!);
  if (gaps.length === 0) gaps = [6 * systemSpacing(systems[0]!)];
  return systems.map((_, i) => {
    const above = i > 0 ? gaps[i - 1]! : gaps[0]!;
    const below = i < systems.length - 1 ? gaps[i]! : gaps[gaps.length - 1]!;
    return [
      Math.max(tops[i]! - (1 - UPPER_SHARE) * above, 0),
      Math.min(bottoms[i]! + UPPER_SHARE * below, pageHeight),
    ];
  });
}

const norm = (value: number, size: number): number =>
  Math.round(Math.min(Math.max(value / size, 0), 1) * 10000) / 10000;

/**
 * A gts document with only the layout layer filled. Pages without systems
 * are expected to be filtered out by the caller. Measures are numbered m1,
 * m2, ... in written order (page, system, left to right) and all go into
 * one unlabeled section until the structure layer adds rehearsal marks.
 */
export function buildDocument(pdfName: string, sha256: string, pages: ScannedPage[]): GtsDocument {
  const measures: Measure[] = [];
  for (const page of pages) {
    const { layout } = page;
    const bands = systemBands(layout.systems, layout.height);
    layout.systems.forEach((system, i) => {
      const [y0, y1] = bands[i]!;
      for (const [x0, x1] of measureSpans(system)) {
        measures.push({
          id: `m${measures.length + 1}`,
          region: {
            page: page.index,
            bbox: [norm(x0, layout.width), norm(y0, layout.height), norm(x1, layout.width), norm(y1, layout.height)],
          },
        });
      }
    });
  }
  return {
    format: "gts",
    version: "0.1",
    meta: { title: pdfName.replace(/\.[^.]*$/, ""), layers: ["layout"] },
    source: {
      file: pdfName,
      sha256,
      pages: pages.map((p) => ({ index: p.index, rotation: p.layout.rotation as 0 | 90 | 180 | 270 })) as GtsDocument["source"]["pages"],
    },
    sections: [{ measures }],
  };
}

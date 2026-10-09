/**
 * Which part of a page each request shows: one crop per system (a line of
 * music), taken from the measure regions of the layout layer alone, so it
 * works for a fresh scan and for a gts file loaded later.
 */

import { type GtsDocument, measures } from "@guitarmr/gts";

type Bbox = [number, number, number, number];

export interface SystemCrop {
  page: number;
  /** Normalized [x0, y0, x1, y1] on the upright page. */
  bbox: Bbox;
  /** Measures left to right, x0/x1 normalized within the crop (0..1). */
  measures: { id: string; x0: number; x1: number }[];
}

/** Side margin added around a system, as a share of the page width. */
export const CROP_MARGIN = 0.02;

/**
 * Systems in written order. Measures of one system share their band (the
 * layout layer gives them the same y0/y1), so equal bands on a page form a
 * system; measures without a region are skipped.
 */
export function systemCrops(document: GtsDocument): SystemCrop[] {
  const crops: SystemCrop[] = [];
  let current: { page: number; bbox: Bbox; items: { id: string; bbox: Bbox }[] } | null = null;
  const flush = () => {
    if (!current) return;
    const [, y0, , y1] = current.bbox;
    const x0 = Math.max(Math.min(...current.items.map((m) => m.bbox[0])) - CROP_MARGIN, 0);
    const x1 = Math.min(Math.max(...current.items.map((m) => m.bbox[2])) + CROP_MARGIN, 1);
    const w = x1 - x0;
    crops.push({
      page: current.page,
      bbox: [x0, y0, x1, y1],
      measures: current.items.map((m) => ({ id: m.id, x0: (m.bbox[0] - x0) / w, x1: (m.bbox[2] - x0) / w })),
    });
  };
  for (const m of measures(document)) {
    const region = m.region;
    if (!region || !m.id) continue;
    const bbox = region.bbox as Bbox;
    const same =
      current &&
      current.page === region.page &&
      Math.abs(current.bbox[1] - bbox[1]) < 1e-3 &&
      Math.abs(current.bbox[3] - bbox[3]) < 1e-3 &&
      bbox[0] >= current.items[current.items.length - 1]!.bbox[0];
    if (!same) {
      flush();
      current = { page: region.page, bbox, items: [] };
    }
    current!.items.push({ id: m.id, bbox });
  }
  flush();
  return crops;
}

/** Crops grouped by page, in page order. */
export function cropsByPage(document: GtsDocument): Map<number, SystemCrop[]> {
  const pages = new Map<number, SystemCrop[]>();
  for (const crop of systemCrops(document)) pages.set(crop.page, [...(pages.get(crop.page) ?? []), crop]);
  return pages;
}

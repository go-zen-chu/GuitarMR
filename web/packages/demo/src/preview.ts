/**
 * Detection of one page plus a small upright preview of it. Runs in the
 * page's Web Worker (bundled after the layoutscan core, see scripts/build.ts)
 * so the UI stays responsive while a 3000 px page is analyzed. A photo is
 * corrected first (sheet cut out, perspective and lighting fixed), so the
 * preview, and the images Claude reads, come from the corrected page.
 */

import { type PageLayout, analyzePage, correctPhoto, uprightImage } from "@guitarmr/layoutscan";
import type { RgbaImage } from "@guitarmr/layoutscan";

/** Long side of the preview image: shown on screen and cut into the images Claude reads. */
export const PREVIEW_LONG_SIDE = 2400;

export interface DetectRequest {
  index: number;
  image: RgbaImage;
  /** A camera photo rather than a rendered PDF page: correct it before detection. */
  photo?: boolean;
}

export interface DetectResult {
  index: number;
  layout: PageLayout;
  /** The upright page scaled by `scale`; null when no system was found. */
  preview: RgbaImage | null;
  scale: number;
  ms: number;
  /** Photos only: the sheet's corners normalized to the photo, null when none was found. */
  paper?: [number, number][] | null;
}

/** Downscale RGBA pixels by averaging each source box (no-op if already small). */
export function shrink(image: RgbaImage, longSide: number): { image: RgbaImage; scale: number } {
  const scale = Math.min(longSide / Math.max(image.width, image.height), 1);
  if (scale === 1) return { image, scale };
  const width = Math.max(Math.round(image.width * scale), 1);
  const height = Math.max(Math.round(image.height * scale), 1);
  const data = new Uint8ClampedArray(width * height * 4);
  const sum = new Float64Array(4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y / scale);
    const y1 = Math.min(Math.max(Math.floor((y + 1) / scale), y0 + 1), image.height);
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x / scale);
      const x1 = Math.min(Math.max(Math.floor((x + 1) / scale), x0 + 1), image.width);
      sum.fill(0);
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * image.width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) {
          sum[0]! += image.data[i]!;
          sum[1]! += image.data[i + 1]!;
          sum[2]! += image.data[i + 2]!;
          sum[3]! += image.data[i + 3]!;
        }
      }
      const n = (y1 - y0) * (x1 - x0);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 4; c++) data[o + c] = sum[c]! / n;
    }
  }
  return { image: { width, height, data }, scale };
}

export function detect({ index, image, photo }: DetectRequest): DetectResult {
  const started = performance.now();
  let page = image;
  let paper: DetectResult["paper"];
  if (photo) {
    const corrected = correctPhoto(image);
    page = corrected.image;
    paper = corrected.paper?.map(([x, y]) => [x / image.width, y / image.height]) ?? null;
  }
  const layout = analyzePage(page);
  let preview: RgbaImage | null = null;
  let scale = 1;
  if (layout.systems.length) ({ image: preview, scale } = shrink(uprightImage(page, layout), PREVIEW_LONG_SIDE));
  return { index, layout, preview, scale, ms: Math.round(performance.now() - started), ...(photo ? { paper } : {}) };
}

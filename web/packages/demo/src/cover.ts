/**
 * Covers for the score list: a small JPEG of a score's first page, kept
 * with the score in the library, and a drawn stand-in (title and chords on
 * staff paper) for scores that have no page to show.
 */

import type { RgbaImage } from "@guitarmr/layoutscan";
import { shrink } from "./preview.ts";

/** Long side of a cover, in pixels (two list columns on a phone, at 2x). */
const COVER_LONG_SIDE = 480;

/** A small copy of page pixels for a cover; always a copy, as the page's pixels may be handed to the worker. */
export function coverPixels(image: RgbaImage): RgbaImage {
  const { image: small } = shrink(image, COVER_LONG_SIDE);
  return small === image ? { ...image, data: new Uint8ClampedArray(image.data) } : small;
}

/** Cover pixels as a JPEG data URL, small enough to keep in the library. */
export function coverUrl(image: RgbaImage): string {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const url = canvas.toDataURL("image/jpeg", 0.8);
  canvas.width = 0;
  return url;
}

/** The cover of a score: its first page, or the title and first chords on staff paper. */
export function coverArt(cover: string | undefined, title: string, chords: readonly string[]): HTMLElement {
  const box = document.createElement("div");
  box.className = "cover";
  box.setAttribute("aria-hidden", "true");
  if (cover) {
    const img = document.createElement("img");
    img.src = cover;
    img.alt = "";
    img.decoding = "async";
    box.append(img);
    return box;
  }
  box.classList.add("drawn");
  const name = document.createElement("strong");
  name.textContent = title;
  const line = document.createElement("span");
  line.textContent = chords.slice(0, 8).join("  ");
  box.append(name, line);
  return box;
}

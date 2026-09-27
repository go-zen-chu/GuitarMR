/**
 * PDF input through pdf.js. Works in Node (legacy build, @napi-rs/canvas
 * picked up by pdf.js) and in the browser (pass the regular build's
 * `getDocument`, e.g. from a worker with OffscreenCanvas).
 */

import type { RgbaImage } from "./image.ts";

/**
 * Long side of the rendered page in pixels. Staff lines of scanned A4 pages
 * are 1-2 px thick at this size, enough for the morphology in detect.ts.
 */
export const RENDER_LONG_SIDE = 3000;

interface PdfJs {
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocumentProxy>; destroy(): Promise<void> };
}
interface PdfDocumentProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  canvasFactory: { create(w: number, h: number): { canvas: unknown; context: CanvasLike } };
}
interface PdfPageProxy {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvasContext: CanvasLike; canvas: unknown; viewport: unknown }): { promise: Promise<void> };
  cleanup(): void;
}
interface CanvasLike {
  getImageData(x: number, y: number, w: number, h: number): RgbaImage;
}

/** Yield [page index, RGBA pixels] for every page, rendered at `longSide` px. */
export async function* renderPages(
  pdfjs: PdfJs,
  data: Uint8Array,
  longSide = RENDER_LONG_SIDE,
): AsyncGenerator<[number, RgbaImage]> {
  // pdf.js takes over (detaches) the buffer it is given; keep the caller's bytes intact.
  const task = pdfjs.getDocument({ data: data.slice() });
  const doc = await task.promise;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: longSide / Math.max(base.width, base.height) });
      const width = Math.round(viewport.width);
      const height = Math.round(viewport.height);
      const { canvas, context } = doc.canvasFactory.create(width, height);
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      const image = context.getImageData(0, 0, width, height);
      page.cleanup();
      yield [n - 1, { width: image.width, height: image.height, data: image.data }];
    }
  } finally {
    await task.destroy();
  }
}

/** Hex SHA-256 of the file bytes (Web Crypto, available in browsers and Node). */
export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as Uint8Array<ArrayBuffer>);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

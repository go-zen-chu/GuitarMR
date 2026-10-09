/**
 * Reading with Claude: one request per page, carrying one image per system
 * (cut from the upright page, with measure ids in a strip above), through
 * the claude.ai "sample" capability, so it runs on the viewer's own Claude
 * account and nothing else sees the score.
 */

import type { GtsDocument } from "@guitarmr/gts";
import { type SystemCrop, applyReading, cropsByPage, pagePrompt, parseReading } from "@guitarmr/extract";

/** The part of the claude.ai sample capability used here. */
export interface Sample {
  json<T = unknown>(input: string, options?: { images?: Blob[]; signal?: AbortSignal }): Promise<T>;
  limits(): Promise<{ images?: { maxCount: number } }>;
}

export interface ReaderHost {
  doc(): GtsDocument;
  commit(doc: GtsDocument): void;
  pageImage(page: number): { blob: Blob; width: number; height: number } | undefined;
  progress(text: string): void;
}

export const TAG_COLOR = "#d0167a";

const jpegOf = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9));

/**
 * One JPEG per system: the system's band with a strip of measure tags on
 * top. With `header`, the page above the first system comes first.
 */
export async function systemImages(
  page: { blob: Blob; width: number; height: number },
  crops: SystemCrop[],
  header = false,
): Promise<Blob[]> {
  const bitmap = await createImageBitmap(page.blob);
  try {
    const blobs: Blob[] = [];
    if (header) {
      // Everything above the first system's band (its own margin included).
      const first = crops[0];
      const bandTop = first ? first.bbox[1] + first.band[0] * (first.bbox[3] - first.bbox[1]) : 0;
      const h = Math.max(Math.round(bandTop * page.height), Math.round(page.height * 0.08));
      const canvas = document.createElement("canvas");
      canvas.width = page.width;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, page.width, h, 0, 0, page.width, h);
      blobs.push(await jpegOf(canvas));
      canvas.width = 0;
    }
    for (const crop of crops) {
      const [x0, y0, x1, y1] = crop.bbox;
      const sx = Math.round(x0 * page.width);
      const sy = Math.round(y0 * page.height);
      const sw = Math.max(Math.round((x1 - x0) * page.width), 1);
      const sh = Math.max(Math.round((y1 - y0) * page.height), 1);
      const strip = Math.max(Math.round(sw / 30), 28);
      const canvas = document.createElement("canvas");
      canvas.width = sw;
      canvas.height = sh + strip;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, sw, strip);
      ctx.drawImage(bitmap, sx, sy, sw, sh, 0, strip, sw, sh);
      // Fade the context margins above and below the system's own band.
      ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
      ctx.fillRect(0, strip, sw, crop.band[0] * sh);
      ctx.fillRect(0, strip + crop.band[1] * sh, sw, sh - crop.band[1] * sh);
      ctx.font = `bold ${Math.round(strip * 0.62)}px sans-serif`;
      ctx.textBaseline = "middle";
      for (const m of crop.measures) {
        const left = m.x0 * sw;
        const right = m.x1 * sw;
        ctx.fillStyle = TAG_COLOR;
        ctx.fillRect(left, 0, 2, strip);
        ctx.fillRect(right - 2, 0, 2, strip);
        const label = m.id;
        const w = ctx.measureText(label).width + strip * 0.4;
        ctx.fillRect(left + 4, strip * 0.1, w, strip * 0.8);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, left + 4 + strip * 0.2, strip * 0.52);
      }
      blobs.push(await jpegOf(canvas));
      canvas.width = 0;
    }
    return blobs;
  } finally {
    bitmap.close();
  }
}

/** Errors after which the next page may still work. */
const PAGE_ERRORS = new Set(["invalid_json", "refused", "image_rejected", "prompt_too_large"]);

export interface ReadResult {
  warnings: string[];
  /** The error that stopped reading, if any (a claude.ai SampleError). */
  error?: { code: string; message: string };
}

/** Read the given pages in order; each finished request is committed at once. */
export async function readPages(sample: Sample, host: ReaderHost, pages: number[], signal: AbortSignal): Promise<ReadResult> {
  const maxCount = (await sample.limits().catch(() => null))?.images?.maxCount ?? 0;
  if (maxCount < 1) return { warnings: [], error: { code: "images_unavailable", message: "no images" } };
  const firstPage = Math.min(...cropsByPage(host.doc()).keys());
  const warnings: string[] = [];
  for (const [n, page] of pages.entries()) {
    const crops = cropsByPage(host.doc()).get(page) ?? [];
    const image = host.pageImage(page);
    if (!crops.length || !image) continue;
    // The page-top image for the header takes one of the first request's slots.
    const header = page === firstPage && maxCount > 1;
    for (let i = 0; i < crops.length; ) {
      const first = i === 0 && header;
      const chunk = crops.slice(i, i + maxCount - (first ? 1 : 0));
      i += chunk.length;
      const ids = chunk.flatMap((c) => c.measures.map((m) => m.id));
      host.progress(`p${page + 1} を読んでいます（${n + 1} / ${pages.length} ページ）…`);
      try {
        const images = await systemImages(image, chunk, first);
        const prompt = pagePrompt(chunk, { header: first });
        const answer = await sample.json(prompt, { images, signal });
        const reading = parseReading(answer, ids);
        warnings.push(...reading.warnings.map((w) => `p${page + 1} ${w}`));
        host.commit(applyReading(host.doc(), reading));
      } catch (e) {
        const error = e as { code?: string; message?: string };
        const code = error.code ?? "upstream_error";
        if (!PAGE_ERRORS.has(code)) return { warnings, error: { code, message: error.message ?? String(e) } };
        warnings.push(`p${page + 1}: ${code === "invalid_json" ? "答えを読み取れませんでした" : "このページは読めませんでした"}（${code}）`);
      }
    }
  }
  return { warnings };
}

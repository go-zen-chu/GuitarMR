/**
 * Make a clean engraved page look like a scan (skew, blur, noise, a turn on
 * the scanner) or like a phone photo of the sheet on a desk, and write
 * pages into a minimal JPEG-based PDF.
 */

import { createCanvas } from "@napi-rs/canvas";
import { type Quad, type RgbaImage, quadToSquare } from "@guitarmr/layoutscan";

export const PAPER: [number, number, number] = [248, 246, 244];

/** Deterministic PRNG (mulberry32) so regenerated samples are identical. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rotate counter-clockwise by a small angle around the center, bilinear, paper-colored borders. */
function rotateBilinear(image: RgbaImage, degrees: number): RgbaImage {
  const { width, height, data } = image;
  const out = new Uint8ClampedArray(data.length);
  const a = Math.cos((degrees * Math.PI) / 180);
  const b = Math.sin((degrees * Math.PI) / 180);
  const cx = width / 2;
  const cy = height / 2;
  const at = (x: number, y: number, c: number): number =>
    x < 0 || y < 0 || x >= width || y >= height ? (c < 3 ? PAPER[c]! : 255) : data[(y * width + x) * 4 + c]!;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = a * (x - cx) - b * (y - cy) + cx;
      const sy = b * (x - cx) + a * (y - cy) + cy;
      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const fx = sx - x0;
      const fy = sy - y0;
      for (let c = 0; c < 4; c++) {
        const top = at(x0, y0, c) * (1 - fx) + at(x0 + 1, y0, c) * fx;
        const bottom = at(x0, y0 + 1, c) * (1 - fx) + at(x0 + 1, y0 + 1, c) * fx;
        out[(y * width + x) * 4 + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return { width, height, data: out };
}

/** 3x3 Gaussian blur (sigma 0.8), separable. */
function blur(image: RgbaImage): RgbaImage {
  const { width, height, data } = image;
  const k = [0.2392, 0.5216, 0.2392];
  const pass = (src: Uint8ClampedArray | Uint8Array, dx: number, dy: number): Uint8ClampedArray => {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let c = 0; c < 3; c++) {
          let v = 0;
          for (let i = -1; i <= 1; i++) {
            const xx = Math.min(Math.max(x + i * dx, 0), width - 1);
            const yy = Math.min(Math.max(y + i * dy, 0), height - 1);
            v += k[i + 1]! * src[(yy * width + xx) * 4 + c]!;
          }
          out[(y * width + x) * 4 + c] = v;
        }
        out[(y * width + x) * 4 + 3] = 255;
      }
    }
    return out;
  };
  return { width, height, data: pass(pass(data, 1, 0), 0, 1) };
}

/** Gaussian noise (Box-Muller) with a fixed seed. */
function addNoise(image: RgbaImage, sigma: number, seed: number): RgbaImage {
  const next = random(seed);
  const data = new Uint8ClampedArray(image.data);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const g = Math.sqrt(-2 * Math.log(next() || 1e-12)) * Math.cos(2 * Math.PI * next());
      data[i + c] = data[i + c]! + g * sigma;
    }
  }
  return { ...image, data };
}

/** Turn counter-clockwise by a multiple of 90 degrees (how the paper lay on the scanner). */
function turn(image: RgbaImage, counterClockwise: number): RgbaImage {
  const turns = (((counterClockwise / 90) % 4) + 4) % 4;
  if (turns === 0) return image;
  const { width, height, data } = image;
  const w = turns === 2 ? width : height;
  const h = turns === 2 ? height : width;
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [sx, sy] = turns === 1 ? [width - 1 - y, x] : turns === 2 ? [width - 1 - x, height - 1 - y] : [y, height - 1 - x];
      out.set(data.subarray((sy * width + sx) * 4, (sy * width + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data: out };
}

/**
 * Blur, noise, a small skew and a turn by `rotation` degrees, like a scan.
 * `rotation` is how far the paper was turned counter-clockwise on the
 * scanner, so layout detection reports it back as the clockwise correction
 * (90 -> 90, 180 -> 180).
 */
export function simulateScan(page: RgbaImage, rotation: number, skew: number, seed = 0): RgbaImage {
  return turn(addNoise(blur(rotateBilinear(page, skew)), 2.5, seed + 1), rotation);
}

/** Size of a simulated phone photo (portrait, 3:4). */
export const PHOTO_WIDTH = 2268;
export const PHOTO_HEIGHT = 3024;

/**
 * Where the sheet lies in a simulated photo, as fractions of the photo:
 * the page's own top-left, top-right, bottom-right and bottom-left corners.
 * A pinhole projection (a phone's 26 mm equivalent lens) of an A4 sheet
 * 31 cm away, the phone tilted 22° toward the top of the page, turned 7°
 * and rolled 2°, so the far edge is shorter.
 */
export const PHOTO_CORNERS: Quad = [
  [0.2278, 0.2491],
  [0.799, 0.2185],
  [0.923, 0.9393],
  [0.1011, 0.9207],
];

/**
 * A phone photo of the page lying on a desk: the sheet placed on `corners`
 * (fractions of the photo, see PHOTO_CORNERS) with perspective, a dark
 * wooden desk around it, light falling off to one side with a warm cast,
 * then blur and noise. Also returns the sheet's corners in photo pixels.
 */
export function simulatePhoto(page: RgbaImage, corners: Quad = PHOTO_CORNERS, seed = 0): { image: RgbaImage; paper: Quad } {
  const width = PHOTO_WIDTH;
  const height = PHOTO_HEIGHT;
  const paper = corners.map(([x, y]) => [x * width, y * height]) as Quad;
  const toPage = quadToSquare(paper);
  const next = random(seed + 7);
  const grain = Array.from({ length: 64 }, () => next());
  const data = new Uint8ClampedArray(width * height * 4);
  const { width: pw, height: ph, data: src } = page;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const [u, v] = toPage(x + 0.5, y + 0.5);
      let rgb: [number, number, number];
      if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
        const sx = Math.min(Math.max(u * pw - 0.5, 0), pw - 1.001);
        const sy = Math.min(Math.max(v * ph - 0.5, 0), ph - 1.001);
        const ix = Math.floor(sx);
        const iy = Math.floor(sy);
        const fx = sx - ix;
        const fy = sy - iy;
        const i = (iy * pw + ix) * 4;
        const j = i + pw * 4;
        rgb = [0, 1, 2].map((c) => {
          const top = src[i + c]! + (src[i + 4 + c]! - src[i + c]!) * fx;
          const bottom = src[j + c]! + (src[j + 4 + c]! - src[j + c]!) * fx;
          return top + (bottom - top) * fy;
        }) as [number, number, number];
      } else {
        // Wood grain: stripes along x with a slow wobble.
        const g = grain[Math.floor((y / height) * 64 + 3 * Math.sin(x / 90)) & 63]!;
        rgb = [92 + 26 * g, 70 + 20 * g, 52 + 14 * g];
      }
      // Light from the top left falling off to the bottom right, warm.
      const light = 1.02 - 0.38 * ((0.7 * x) / width + (0.3 * y) / height) ** 1.3;
      data[o] = rgb[0] * light;
      data[o + 1] = rgb[1] * light * 0.94;
      data[o + 2] = rgb[2] * light * 0.82;
      data[o + 3] = 255;
    }
  }
  return { image: addNoise(blur({ width, height, data }), 3, seed + 11), paper };
}

/** RGBA pixels as a JPEG file, like a phone camera writes. */
export async function encodeJpeg(image: RgbaImage, quality = 85): Promise<Uint8Array> {
  const canvas = createCanvas(image.width, image.height);
  const ctx = canvas.getContext("2d");
  const pixels = ctx.createImageData(image.width, image.height);
  pixels.data.set(image.data);
  ctx.putImageData(pixels, 0, 0);
  return new Uint8Array(await canvas.encode("jpeg", quality));
}

/** Write pages as JPEG images into a minimal PDF (A4, portrait or landscape per page). */
export async function writePdf(pages: RgbaImage[], quality = 80): Promise<Uint8Array> {
  const objects: Uint8Array[] = [];
  const enc = new TextEncoder();
  const add = (...parts: (string | Uint8Array)[]): number => {
    const chunks = parts.map((p) => (typeof p === "string" ? enc.encode(p) : p));
    const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const c of chunks) {
      total.set(c, offset);
      offset += c.length;
    }
    objects.push(total);
    return objects.length;
  };
  const catalog = add("");
  const pagesObj = add("");
  const kids: number[] = [];
  for (const image of pages) {
    const canvas = createCanvas(image.width, image.height);
    const ctx = canvas.getContext("2d");
    const pixels = ctx.createImageData(image.width, image.height);
    pixels.data.set(image.data);
    ctx.putImageData(pixels, 0, 0);
    const jpeg = new Uint8Array(await canvas.encode("jpeg", quality));
    const [pw, ph] = image.height >= image.width ? [595.28, 841.89] : [841.89, 595.28];
    const xobject = add(
      `<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      "\nendstream",
    );
    const content = `q ${pw.toFixed(2)} 0 0 ${ph.toFixed(2)} 0 0 cm /Im0 Do Q`;
    const stream = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] ` +
          `/Resources << /XObject << /Im0 ${xobject} 0 R >> >> /Contents ${stream} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objects[pagesObj - 1] = enc.encode(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);

  const parts: Uint8Array[] = [enc.encode("%PDF-1.4\n%âãÏÓ\n")];
  let length = parts[0]!.length;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(length);
    const head = enc.encode(`${i + 1} 0 obj\n`);
    const tail = enc.encode("\nendobj\n");
    parts.push(head, obj, tail);
    length += head.length + obj.length + tail.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("") +
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(enc.encode(xref));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

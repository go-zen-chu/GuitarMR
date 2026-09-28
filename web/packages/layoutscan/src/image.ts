/**
 * Minimal raster operations used by the detector, on plain typed arrays so
 * the same code runs in a browser worker and in Node.
 *
 * Planes are single-channel images stored row by row. Masks hold 0 or 1.
 */

export interface Plane {
  width: number;
  height: number;
  data: Uint8Array;
}

/** RGBA pixels as returned by a canvas (ImageData-compatible). */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

export function plane(width: number, height: number, fill = 0): Plane {
  const data = new Uint8Array(width * height);
  if (fill) data.fill(fill);
  return { width, height, data };
}

/** Luma (OpenCV BGR2GRAY weights) and HSV saturation (0..255) of an RGBA image. */
export function grayAndSaturation(image: RgbaImage): { gray: Plane; saturation: Plane } {
  const { width, height, data } = image;
  const gray = plane(width, height);
  const saturation = plane(width, height);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    gray.data[i] = (r * 4899 + g * 9617 + b * 1868 + 8192) >> 14;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    saturation.data[i] = max === 0 ? 0 : Math.round((255 * (max - min)) / max);
  }
  return { gray, saturation };
}

/**
 * Mean over a block x block window with replicated borders, rounded like a
 * uint8 box filter. Computed separably with running sums.
 */
export function boxMean(src: Plane, block: number): Plane {
  const { width, height, data } = src;
  const r = block >> 1;
  const rows = new Uint32Array(width * height);
  const clampX = (x: number) => (x < 0 ? 0 : x >= width ? width - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= height ? height - 1 : y);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += data[row + clampX(x)]!;
    for (let x = 0; x < width; x++) {
      rows[row + x] = sum;
      sum += data[row + clampX(x + r + 1)]! - data[row + clampX(x - r)]!;
    }
  }
  const out = plane(width, height);
  const area = block * block;
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += rows[clampY(y) * width + x]!;
    for (let y = 0; y < height; y++) {
      out.data[y * width + x] = Math.round(sum / area);
      sum += rows[clampY(y + r + 1) * width + x]! - rows[clampY(y - r) * width + x]!;
    }
  }
  return out;
}

/** Horizontal opening with a 1 x length line: drops runs shorter than `length`. */
export function openRows(mask: Plane, length: number): Plane {
  const { width, height, data } = mask;
  const out = plane(width, height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let x = 0;
    while (x < width) {
      if (!data[row + x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < width && data[row + end]) end++;
      if (end - x >= length) out.data.fill(1, row + x, row + end);
      x = end;
    }
  }
  return out;
}

/** Horizontal closing with a 1 x length line: fills gaps shorter than `length` between runs. */
export function closeRows(mask: Plane, length: number): Plane {
  const { width, height, data } = mask;
  const out = new Uint8Array(data);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let lastInk = -1;
    for (let x = 0; x < width; x++) {
      if (!data[row + x]) continue;
      if (lastInk >= 0 && x - lastInk - 1 > 0 && x - lastInk - 1 < length) {
        out.fill(1, row + lastInk + 1, row + x);
      }
      lastInk = x;
    }
  }
  return { width, height, data: out };
}

/** Horizontal dilation of a mask by `radius` pixels on each side. */
export function dilateRows(mask: Plane, radius: number): Plane {
  const { width, height, data } = mask;
  const out = plane(width, height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let lastInk = -Infinity;
    for (let x = 0; x < width; x++) {
      if (data[row + x]) lastInk = x;
      if (x - lastInk <= radius) out.data[row + x] = 1;
    }
    let nextInk = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      if (data[row + x]) nextInk = x;
      if (nextInk - x <= radius) out.data[row + x] = 1;
    }
  }
  return out;
}

/** Maximum over a horizontal window of 2 * radius + 1 pixels (grayscale dilation). */
export function maxRows(src: Plane, radius: number): Plane {
  const { width, height, data } = src;
  const out = plane(width, height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let m = 0;
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      for (let i = x0; i <= x1; i++) {
        const v = data[row + i]!;
        if (v > m) m = v;
      }
      out.data[row + x] = m;
    }
  }
  return out;
}

export function or(a: Plane, b: Plane): Plane {
  const out = plane(a.width, a.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i]! | b.data[i]!;
  return out;
}

/** a AND NOT b */
export function subtract(a: Plane, b: Plane): Plane {
  const out = plane(a.width, a.height);
  for (let i = 0; i < out.data.length; i++) out.data[i] = a.data[i]! && !b.data[i] ? 1 : 0;
  return out;
}

export function fraction(mask: Plane): number {
  let n = 0;
  for (let i = 0; i < mask.data.length; i++) n += mask.data[i]!;
  return n / mask.data.length;
}

/**
 * Rotate by a multiple of 90 degrees clockwise. Works on any number of
 * interleaved channels (1 for planes, 4 for RGBA).
 */
export function rotate90<T extends Uint8Array | Uint8ClampedArray>(
  data: T,
  width: number,
  height: number,
  clockwise: number,
  channels = 1,
): { data: T; width: number; height: number } {
  const turns = (((clockwise / 90) % 4) + 4) % 4;
  if (turns === 0) return { data, width, height };
  const outWidth = turns === 2 ? width : height;
  const outHeight = turns === 2 ? height : width;
  const out = new (data.constructor as { new (n: number): T })(data.length);
  for (let y = 0; y < outHeight; y++) {
    for (let x = 0; x < outWidth; x++) {
      let sx: number;
      let sy: number;
      if (turns === 1) {
        sx = y;
        sy = height - 1 - x;
      } else if (turns === 2) {
        sx = width - 1 - x;
        sy = height - 1 - y;
      } else {
        sx = width - 1 - y;
        sy = x;
      }
      const d = (y * outWidth + x) * channels;
      const s = (sy * width + sx) * channels;
      for (let c = 0; c < channels; c++) out[d + c] = data[s + c]!;
    }
  }
  return { data: out, width: outWidth, height: outHeight };
}

export function rotatePlane90(p: Plane, clockwise: number): Plane {
  return rotate90(p.data, p.width, p.height, clockwise);
}

/**
 * Rotate counter-clockwise by a small angle around the center (same sense
 * as OpenCV's getRotationMatrix2D), nearest neighbor, keeping the size.
 */
export function rotateSmall<T extends Uint8Array | Uint8ClampedArray>(
  data: T,
  width: number,
  height: number,
  degrees: number,
  channels = 1,
  fill = 0,
): T {
  if (Math.abs(degrees) < 1e-3) return data;
  const a = Math.cos((degrees * Math.PI) / 180);
  const b = Math.sin((degrees * Math.PI) / 180);
  const cx = width / 2;
  const cy = height / 2;
  const out = new (data.constructor as { new (n: number): T })(data.length);
  if (fill) out.fill(fill);
  for (let y = 0; y < height; y++) {
    const dy = y - cy;
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const sx = Math.round(a * dx - b * dy + cx);
      const sy = Math.round(b * dx + a * dy + cy);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const d = (y * width + x) * channels;
      const s = (sy * width + sx) * channels;
      for (let c = 0; c < channels; c++) out[d + c] = data[s + c]!;
    }
  }
  return out;
}

/** Downscale by area averaging to `scale` (< 1). */
export function resizeArea(src: Plane, scale: number): Plane {
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const out = plane(width, height);
  const fx = src.width / width;
  const fy = src.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * fy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * fx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
      let sum = 0;
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * src.width;
        for (let xx = x0; xx < x1; xx++) sum += src.data[row + xx]!;
      }
      out.data[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0)));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Small numeric helpers (numpy equivalents)

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((p, q) => p - q);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Linear-interpolated percentile (numpy default). */
export function percentile(sorted: readonly number[], p: number): number {
  const pos = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

export function mean(values: readonly number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

export function diff(values: readonly number[]): number[] {
  return values.slice(1).map((v, i) => v - values[i]!);
}

/** numpy.interp for increasing xs, clamping outside the range. */
export function interp(x: number, xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  if (x <= xs[0]!) return ys[0]!;
  if (x >= xs[n - 1]!) return ys[n - 1]!;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - xs[lo]!) / (xs[hi]! - xs[lo]!);
  return ys[lo]! + t * (ys[hi]! - ys[lo]!);
}

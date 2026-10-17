/**
 * Camera photos of a score page: find the sheet of paper (the large bright
 * area: scores are dark ink on white paper), cut it out with its
 * perspective undone and flatten the lighting, so the page looks like a
 * scan before detection and reading. Pure functions over RGBA pixels, like
 * detect.ts; no OpenCV.
 */

import type { RgbaImage } from "./image.ts";
import { RENDER_LONG_SIDE } from "./pdf.ts";

export type Point = [number, number];
/** Corners of the sheet in photo pixels: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Point, Point, Point, Point];

/** Long side of the downscaled photo the sheet is looked for in. */
const FIND_LONG_SIDE = 480;
/** Radius (downscaled pixels) of the closing that hides ink inside the sheet. */
const INK_RADIUS = 3;
/** The sheet must cover at least this share of the photo. */
const MIN_PAPER_AREA = 0.2;
/** Page sides within this of √2 (A and B paper sizes) are snapped to it. */
const ISO_SNAP = 0.08;
/** Background brightness at which paper becomes pure white. */
const WHITE_POINT = 0.9;
/** Darkens mid tones after flattening, so pencil stays visible. */
const INK_GAMMA = 1.4;

export interface PhotoCorrection {
  /** The corrected page, RENDER_LONG_SIDE on its long side. */
  image: RgbaImage;
  /** The sheet in the photo; null when none was found and the whole photo was used. */
  paper: Quad | null;
}

/** Find the sheet, cut it out upright and flatten its lighting. */
export function correctPhoto(image: RgbaImage, longSide = RENDER_LONG_SIDE): PhotoCorrection {
  const paper = findPaper(image);
  const whole: Quad = [
    [0, 0],
    [image.width, 0],
    [image.width, image.height],
    [0, image.height],
  ];
  return { image: flattenLighting(warpPaper(image, paper ?? whole, longSide, paper !== null)), paper };
}

// ---------------------------------------------------------------------------
// Finding the sheet

interface Small {
  width: number;
  height: number;
  gray: Uint8Array;
  /** Photo pixels per small pixel. */
  step: number;
}

/** Luma of the photo averaged down to FIND_LONG_SIDE. */
function smallGray(image: RgbaImage): Small {
  const step = Math.max(Math.max(image.width, image.height) / FIND_LONG_SIDE, 1);
  const width = Math.max(Math.round(image.width / step), 1);
  const height = Math.max(Math.round(image.height / step), 1);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * step);
    const y1 = Math.min(Math.max(Math.floor((y + 1) * step), y0 + 1), image.height);
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * step);
      const x1 = Math.min(Math.max(Math.floor((x + 1) * step), x0 + 1), image.width);
      let sum = 0;
      for (let sy = y0; sy < y1; sy++) {
        let i = (sy * image.width + x0) * 4;
        for (let sx = x0; sx < x1; sx++, i += 4) sum += image.data[i]! * 299 + image.data[i + 1]! * 587 + image.data[i + 2]! * 114;
      }
      gray[y * width + x] = Math.round(sum / ((y1 - y0) * (x1 - x0) * 1000));
    }
  }
  return { width, height, gray, step };
}

/** Square max (or min) filter of the given radius, separable. */
function extremeFilter(src: Uint8Array, width: number, height: number, radius: number, max: boolean): Uint8Array {
  const pick = max ? Math.max : Math.min;
  const pass = (from: Uint8Array, horizontal: boolean): Uint8Array => {
    const out = new Uint8Array(from.length);
    const [n, m] = horizontal ? [height, width] : [width, height];
    for (let a = 0; a < n; a++) {
      for (let b = 0; b < m; b++) {
        let v = from[horizontal ? a * width + b : b * width + a]!;
        for (let k = Math.max(b - radius, 0); k <= Math.min(b + radius, m - 1); k++) {
          v = pick(v, from[horizontal ? a * width + k : k * width + a]!);
        }
        out[horizontal ? a * width + b : b * width + a] = v;
      }
    }
    return out;
  };
  return pass(pass(src, true), false);
}

/** Otsu's threshold of a gray image. */
export function otsu(gray: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of gray) hist[v]!++;
  let sum = 0;
  for (let v = 0; v < 256; v++) sum += v * hist[v]!;
  let below = 0;
  let belowSum = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    below += hist[t]!;
    if (below === 0 || below === gray.length) continue;
    belowSum += t * hist[t]!;
    const m0 = belowSum / below;
    const m1 = (sum - belowSum) / (gray.length - below);
    const between = below * (gray.length - below) * (m0 - m1) ** 2;
    if (between > best) {
      best = between;
      threshold = t + 1;
    }
  }
  return threshold;
}

/** Mask (1) of the largest 4-connected component of `mask`, and its pixel count. */
function largestComponent(mask: Uint8Array, width: number, height: number): { mask: Uint8Array; area: number } {
  const label = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  let best = 0;
  let bestArea = 0;
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || label[start]) continue;
    next++;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    label[start] = next;
    while (top) {
      const i = stack[--top]!;
      area++;
      const x = i % width;
      const push = (j: number) => {
        if (mask[j] && !label[j]) {
          label[j] = next;
          stack[top++] = j;
        }
      };
      if (x > 0) push(i - 1);
      if (x < width - 1) push(i + 1);
      if (i >= width) push(i - width);
      if (i < mask.length - width) push(i + width);
    }
    if (area > bestArea) {
      bestArea = area;
      best = next;
    }
  }
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = label[i] === best && best ? 1 : 0;
  return { mask: out, area: bestArea };
}

const cross = (o: Point, a: Point, b: Point): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Convex hull (Andrew's monotone chain), counter-clockwise in a y-up frame. */
export function convexHull(points: Point[]): Point[] {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (sorted.length < 3) return sorted;
  const lower: Point[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * The largest-area quadrilateral with corners on a convex polygon. For each
 * diagonal (i, k) the best corner on either side moves forward with k, so
 * the search is quadratic.
 */
export function largestQuad(hull: Point[]): Point[] {
  const n = hull.length;
  if (n <= 4) return hull;
  const at = (i: number): Point => hull[i % n]!;
  const tri = (a: number, b: number, c: number): number => Math.abs(cross(at(a), at(b), at(c)));
  let best = -1;
  let corners = [0, 1, 2, 3];
  for (let i = 0; i < n; i++) {
    let j = i + 1;
    let l = i + 3;
    for (let k = i + 2; k < i + n - 1; k++) {
      while (j + 1 < k && tri(i, j + 1, k) >= tri(i, j, k)) j++;
      if (l <= k) l = k + 1;
      while (l + 1 < i + n && tri(i, k, l + 1) >= tri(i, k, l)) l++;
      const area = tri(i, j, k) + tri(i, k, l);
      if (area > best) {
        best = area;
        corners = [i, j, k, l];
      }
    }
  }
  return corners.map(at);
}

/** Total least squares line through points: a point on it and its unit direction. */
function fitLine(points: Point[]): { at: Point; dir: Point } {
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const [x, y] of points) {
    sxx += (x - mx) ** 2;
    sxy += (x - mx) * (y - my);
    syy += (y - my) ** 2;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { at: [mx, my], dir: [Math.cos(angle), Math.sin(angle)] };
}

function intersect(a: { at: Point; dir: Point }, b: { at: Point; dir: Point }): Point | null {
  const det = a.dir[0] * b.dir[1] - a.dir[1] * b.dir[0];
  if (Math.abs(det) < 1e-6) return null;
  const t = ((b.at[0] - a.at[0]) * b.dir[1] - (b.at[1] - a.at[1]) * b.dir[0]) / det;
  return [a.at[0] + t * a.dir[0], a.at[1] + t * a.dir[1]];
}

/** Corners in the order top-left, top-right, bottom-right, bottom-left (clockwise on screen). */
export function orderCorners(corners: Point[]): Quad {
  const cx = corners.reduce((s, p) => s + p[0], 0) / corners.length;
  const cy = corners.reduce((s, p) => s + p[1], 0) / corners.length;
  const sorted = [...corners].sort((p, q) => Math.atan2(p[1] - cy, p[0] - cx) - Math.atan2(q[1] - cy, q[0] - cx));
  let first = 0;
  sorted.forEach((p, i) => {
    if (p[0] + p[1] < sorted[first]![0] + sorted[first]![1]) first = i;
  });
  return [0, 1, 2, 3].map((i) => sorted[(first + i) % 4]!) as Quad;
}

/**
 * The sheet of paper in a photo: the largest bright area once thin ink is
 * closed over, its convex hull reduced to the four corners, each side then
 * refined by a line fit along the outline (rounded or dog-eared corners
 * fall back to where the straight sides meet). Null when no bright area
 * covers MIN_PAPER_AREA of the photo.
 */
export function findPaper(image: RgbaImage): Quad | null {
  const small = smallGray(image);
  const { width, height } = small;
  const closed = extremeFilter(extremeFilter(small.gray, width, height, INK_RADIUS, true), width, height, INK_RADIUS, false);
  const t = otsu(closed);
  const bright = new Uint8Array(closed.length);
  for (let i = 0; i < closed.length; i++) bright[i] = closed[i]! >= t ? 1 : 0;
  const { mask, area } = largestComponent(bright, width, height);
  if (area < MIN_PAPER_AREA * width * height) return null;

  // The outline: outer pixel edges of each row and column of the sheet.
  const outline: Point[] = [];
  for (let y = 0; y < height; y++) {
    let x0 = -1;
    let x1 = -1;
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x0 < 0) x0 = x;
      x1 = x;
    }
    if (x0 >= 0) outline.push([x0, y + 0.5], [x1 + 1, y + 0.5]);
  }
  for (let x = 0; x < width; x++) {
    let y0 = -1;
    let y1 = -1;
    for (let y = 0; y < height; y++) {
      if (!mask[y * width + x]) continue;
      if (y0 < 0) y0 = y;
      y1 = y;
    }
    if (y0 >= 0) outline.push([x + 0.5, y0], [x + 0.5, y1 + 1]);
  }
  const hullCorners = orderCorners(largestQuad(convexHull(outline)));

  const tolerance = Math.max(2, 0.015 * Math.max(width, height));
  const sides = hullCorners.map((a, i) => {
    const b = hullCorners[(i + 1) % 4]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / length;
    const uy = (b[1] - a[1]) / length;
    const near = outline.filter(([x, y]) => {
      const along = ((x - a[0]) * ux + (y - a[1]) * uy) / length;
      const off = Math.abs((x - a[0]) * uy - (y - a[1]) * ux);
      return along > 0.15 && along < 0.85 && off <= tolerance;
    });
    return near.length >= 8 ? fitLine(near) : null;
  });
  const corners = hullCorners.map((corner, i) => {
    const before = sides[(i + 3) % 4];
    const after = sides[i];
    const meet = before && after ? intersect(before, after) : null;
    // A fit pulled far off by something lying on the sheet edge is not trusted.
    return meet && Math.hypot(meet[0] - corner[0], meet[1] - corner[1]) <= 4 * tolerance ? meet : corner;
  });
  return corners.map(([x, y]) => [
    Math.min(Math.max(x * small.step, 0), image.width),
    Math.min(Math.max(y * small.step, 0), image.height),
  ]) as Quad;
}

// ---------------------------------------------------------------------------
// Perspective

/** Row-major 3x3 matrix of the projective map of the unit square onto `quad`. */
function squareMatrix(quad: Quad): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    const det = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1;
  const b = x3 - x0 + h * x3;
  const d = y1 - y0 + g * y1;
  const e = y3 - y0 + h * y3;
  return [a, b, x0, d, e, y0, g, h, 1];
}

const apply = (m: number[], x: number, y: number): Point => {
  const w = m[6]! * x + m[7]! * y + m[8]!;
  return [(m[0]! * x + m[1]! * y + m[2]!) / w, (m[3]! * x + m[4]! * y + m[5]!) / w];
};

/** Projective map of the unit square onto `quad` ((0,0) → quad[0], (1,0) → quad[1], ...). */
export function squareToQuad(quad: Quad): (u: number, v: number) => Point {
  const m = squareMatrix(quad);
  return (u, v) => apply(m, u, v);
}

/** The inverse of squareToQuad: photo pixels to 0..1 on the corrected page. */
export function quadToSquare(quad: Quad): (x: number, y: number) => Point {
  const [a, b, c, d, e, f, g, h, i] = squareMatrix(quad) as [number, number, number, number, number, number, number, number, number];
  // The adjugate is the inverse up to scale, which a projective map ignores.
  const adj = [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f, d * h - e * g, b * g - a * h, a * e - b * d];
  return (x, y) => apply(adj, x, y);
}

/**
 * Focal length of a phone's main camera in pixels, as a share of the photo
 * diagonal (26 mm equivalent: 26 / 43.3), used when the photo's own
 * perspective cannot tell it.
 */
const PHONE_FOCAL = 0.6;

/**
 * Width / height of the real sheet seen as `quad` in a photo whose optical
 * center is `center` and whose diagonal is `diagonal` pixels. The camera's
 * focal length is solved from the two vanishing points of the quad's sides
 * (Zhang & He, "Whiteboard scanning and image enhancement", 2007); when
 * one pair of sides is (nearly) parallel it cannot be solved and a phone's
 * typical focal length is assumed instead.
 */
export function paperAspect(quad: Quad, center: Point, diagonal: number): number {
  const [tl, tr, br, bl] = quad;
  const h = (p: Point): [number, number, number] => [p[0], p[1], 1];
  const crossH = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const [m1, m2, m3, m4] = [h(tl), h(tr), h(bl), h(br)];
  const k2 = dot(crossH(m1, m4), m3) / dot(crossH(m2, m4), m3);
  const k3 = dot(crossH(m1, m4), m2) / dot(crossH(m3, m4), m2);
  const n2 = m2.map((v, i) => k2 * v - m1[i]!);
  const n3 = m3.map((v, i) => k3 * v - m1[i]!);
  const [u0, v0] = center;
  const solved =
    -(
      n2[0]! * n3[0]! - (n2[0]! * n3[2]! + n2[2]! * n3[0]!) * u0 + n2[2]! * n3[2]! * u0 * u0 +
      n2[1]! * n3[1]! - (n2[1]! * n3[2]! + n2[2]! * n3[1]!) * v0 + n2[2]! * n3[2]! * v0 * v0
    ) / (n2[2]! * n3[2]!);
  // A wide-angle to a 3x zoom lens; anything else is a degenerate solve.
  const f2 = solved >= (0.4 * diagonal) ** 2 && solved <= (2.5 * diagonal) ** 2 ? solved : (PHONE_FOCAL * diagonal) ** 2;
  const q = (n: number[]) => ((n[0]! - u0 * n[2]!) ** 2 + (n[1]! - v0 * n[2]!) ** 2) / f2 + n[2]! ** 2;
  return Math.sqrt(q(n2) / q(n3));
}

/** Share of each side trimmed off the cut-out sheet: its edge mixes in the desk. */
const EDGE_TRIM = 0.004;

/**
 * Cut `quad` out of the photo as an upright rectangle, `longSide` pixels on
 * its long side (bilinear). With `snap` the aspect ratio comes from the
 * perspective (paperAspect), and ratios near √2 (A and B paper) become √2;
 * without it the photo is only scaled.
 */
export function warpPaper(image: RgbaImage, quad: Quad, longSide = RENDER_LONG_SIDE, snap = true): RgbaImage {
  let aspect = snap
    ? paperAspect(quad, [image.width / 2, image.height / 2], Math.hypot(image.width, image.height))
    : image.width / image.height;
  const long = Math.max(aspect, 1 / aspect);
  if (snap && Math.abs(long - Math.SQRT2) / Math.SQRT2 < ISO_SNAP) aspect = aspect >= 1 ? Math.SQRT2 : Math.SQRT1_2;
  const width = aspect >= 1 ? longSide : Math.round(longSide * aspect);
  const height = aspect >= 1 ? Math.round(longSide / aspect) : longSide;
  const trim = snap ? EDGE_TRIM : 0;
  const toQuad = squareToQuad(quad);
  const map = (u: number, v: number) => toQuad(trim + u * (1 - 2 * trim), trim + v * (1 - 2 * trim));
  const { width: sw, height: sh, data: src } = image;
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const [px, py] = map((x + 0.5) / width, v);
      const sx = px - 0.5;
      const sy = py - 0.5;
      const o = (y * width + x) * 4;
      const ix = Math.floor(sx);
      const iy = Math.floor(sy);
      if (ix < 0 || iy < 0 || ix >= sw - 1 || iy >= sh - 1) {
        // Outside the photo (a sheet running past the frame): white paper.
        const cx = Math.min(Math.max(Math.round(sx), 0), sw - 1);
        const cy = Math.min(Math.max(Math.round(sy), 0), sh - 1);
        const inside = sx > -1 && sy > -1 && sx < sw && sy < sh;
        for (let c = 0; c < 3; c++) out[o + c] = inside ? src[(cy * sw + cx) * 4 + c]! : 255;
        out[o + 3] = 255;
        continue;
      }
      const fx = sx - ix;
      const fy = sy - iy;
      const i = (iy * sw + ix) * 4;
      const j = i + sw * 4;
      for (let c = 0; c < 3; c++) {
        const top = src[i + c]! + (src[i + 4 + c]! - src[i + c]!) * fx;
        const bottom = src[j + c]! + (src[j + 4 + c]! - src[j + c]!) * fx;
        out[o + c] = top + (bottom - top) * fy;
      }
      out[o + 3] = 255;
    }
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------------------
// Lighting

/**
 * Divide out uneven lighting and color cast: the paper brightness is
 * estimated per channel on a coarse grid (a high percentile per cell, so
 * ink is ignored), smoothed, interpolated back to every pixel and divided
 * out, so the paper becomes white everywhere and ink keeps its contrast
 * (colored pen stays colored, see COLOR_SATURATION_MIN in detect.ts).
 */
export function flattenLighting(image: RgbaImage): RgbaImage {
  const { width, height, data } = image;
  const cell = Math.max(16, Math.round(Math.max(width, height) / 40));
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const grid = new Float64Array(cols * rows * 3);
  const hist = new Uint32Array(256 * 3);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      hist.fill(0);
      const x1 = Math.min((gx + 1) * cell, width);
      const y1 = Math.min((gy + 1) * cell, height);
      for (let y = gy * cell; y < y1; y++) {
        for (let x = gx * cell, i = (y * width + x) * 4; x < x1; x++, i += 4) {
          hist[data[i]!]!++;
          hist[256 + data[i + 1]!]!++;
          hist[512 + data[i + 2]!]!++;
        }
      }
      const count = (x1 - gx * cell) * (y1 - gy * cell);
      for (let c = 0; c < 3; c++) {
        // 90th percentile: the paper, even in a cell full of writing.
        let seen = 0;
        let v = 255;
        while (v > 0 && seen + hist[c * 256 + v]! < 0.1 * count) seen += hist[c * 256 + v--]!;
        grid[(gy * cols + gx) * 3 + c] = Math.max(v, 32);
      }
    }
  }
  // 3x3 median, then 3x3 mean: one dark cell (a big black blot) does not dent the light.
  const smooth = (from: Float64Array, reduce: (values: number[]) => number): Float64Array => {
    const out = new Float64Array(from.length);
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        for (let c = 0; c < 3; c++) {
          const values: number[] = [];
          for (let y = Math.max(gy - 1, 0); y <= Math.min(gy + 1, rows - 1); y++) {
            for (let x = Math.max(gx - 1, 0); x <= Math.min(gx + 1, cols - 1); x++) values.push(from[(y * cols + x) * 3 + c]!);
          }
          out[(gy * cols + gx) * 3 + c] = reduce(values);
        }
      }
    }
    return out;
  };
  const medianOf = (values: number[]) => values.sort((p, q) => p - q)[values.length >> 1]!;
  const meanOf = (values: number[]) => values.reduce((s, v) => s + v, 0) / values.length;
  const light = smooth(smooth(grid, medianOf), meanOf);

  const curve = new Float64Array(1025);
  for (let k = 0; k <= 1024; k++) curve[k] = 255 * Math.min(k / 1024 / WHITE_POINT, 1) ** INK_GAMMA;
  const out = new Uint8ClampedArray(data.length);
  const row = new Float64Array(cols * 3);
  for (let y = 0; y < height; y++) {
    // Bilinear between cell centers, clamped at the borders.
    const fy = Math.min(Math.max((y + 0.5) / cell - 0.5, 0), rows - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, rows - 1);
    const ty = fy - y0;
    for (let k = 0; k < cols * 3; k++) row[k] = light[y0 * cols * 3 + k]! * (1 - ty) + light[y1 * cols * 3 + k]! * ty;
    for (let x = 0; x < width; x++) {
      const fx = Math.min(Math.max((x + 0.5) / cell - 0.5, 0), cols - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, cols - 1);
      const tx = fx - x0;
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const bg = row[x0 * 3 + c]! * (1 - tx) + row[x1 * 3 + c]! * tx;
        out[i + c] = curve[Math.min(Math.round((1024 * data[i + c]!) / bg), 1024)]!;
      }
      out[i + 3] = 255;
    }
  }
  return { width, height, data: out };
}

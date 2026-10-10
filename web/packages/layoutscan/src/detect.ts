/**
 * Pure image analysis: from a rendered page to systems and measures.
 *
 * Every function works on in-memory pixels and does no I/O, so detection
 * runs the same in a browser worker, in the Node CLI and in tests.
 * Coordinates are pixels in the "upright" page, i.e. after rotating it by a
 * multiple of 90 degrees and removing the small scan skew.
 */

import {
  type Plane,
  type RgbaImage,
  boxMean,
  closeRows,
  diff,
  dilateRows,
  fraction,
  grayAndSaturation,
  interp,
  maxRows,
  mean,
  median,
  openRows,
  or,
  percentile,
  plane,
  resizeArea,
  rotate90,
  rotatePlane90,
  rotateSmall,
  subtract,
} from "./image.ts";

/** Pixels whose HSV saturation exceeds this are colored pen, not pencil/print. */
const COLOR_SATURATION_MIN = 80;

/** A staff line that may bend slightly (paper curvature), as a polyline. */
export interface Line {
  xs: number[]; // anchor x positions, increasing
  ys: number[]; // y at each anchor
  left: number;
  right: number;
}

/** A group of evenly spaced lines (5 = standard staff, 6 = TAB). */
export interface Staff {
  lines: Line[]; // top to bottom
}

/** One line of music: a TAB, optionally with a standard staff above it. */
export interface System {
  tab: Staff;
  staff: Staff | null;
  barlines: number[]; // x of inner bar lines
}

export interface PageLayout {
  rotation: number; // clockwise degrees applied to the rendered page
  skew: number; // additional small counter-clockwise correction, degrees
  width: number; // size of the upright page
  height: number;
  systems: System[];
}

export const lineY = (line: Line, x: number): number => interp(x, line.xs, line.ys);
export const midY = (line: Line): number => median(line.ys);

export const staffLeft = (s: Staff): number => Math.trunc(median(s.lines.map((l) => l.left)));
export const staffRight = (s: Staff): number => Math.trunc(median(s.lines.map((l) => l.right)));
export const staffTop = (s: Staff): number => midY(s.lines[0]!);
export const staffBottom = (s: Staff): number => midY(s.lines[s.lines.length - 1]!);
export const staffTopAt = (s: Staff, x: number): number => lineY(s.lines[0]!, x);
export const staffBottomAt = (s: Staff, x: number): number => lineY(s.lines[s.lines.length - 1]!, x);
export const staffSpacing = (s: Staff): number => median(diff(s.lines.map(midY)));

export const systemTop = (s: System): number => (s.staff ? staffTop(s.staff) : staffTop(s.tab));
export const systemBottom = (s: System): number => staffBottom(s.tab);
export const systemTopAt = (s: System, x: number): number =>
  s.staff ? staffTopAt(s.staff, x) : staffTopAt(s.tab, x);
export const systemBottomAt = (s: System, x: number): number => staffBottomAt(s.tab, x);
export const systemLeft = (s: System): number => staffLeft(s.tab);
export const systemRight = (s: System): number => staffRight(s.tab);
export const systemSpacing = (s: System): number => staffSpacing(s.tab);

// ---------------------------------------------------------------------------
// Ink extraction

/**
 * Mask of pencil and printed ink; colored pen is dropped. An adaptive
 * threshold keeps faint printed staff lines that a global one loses.
 */
export function inkMask(gray: Plane, saturation: Plane): Plane {
  const means = boxMean(gray, 31);
  const out = plane(gray.width, gray.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = gray.data[i]! <= means.data[i]! - 12 && saturation.data[i]! <= COLOR_SATURATION_MIN ? 1 : 0;
  }
  return out;
}

/**
 * Strokes darker than the paper to their left and right. The background is
 * estimated along the row only, so faint printed bar lines between closely
 * spaced TAB lines survive, while horizontal lines are excluded.
 */
export function verticalInk(gray: Plane, saturation: Plane, contrast = 20): Plane {
  const background = maxRows(gray, 7);
  const out = plane(gray.width, gray.height);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] =
      background.data[i]! - gray.data[i]! > contrast && saturation.data[i]! <= COLOR_SATURATION_MIN ? 1 : 0;
  }
  return out;
}

/** Keep only long horizontal strokes (staff lines). */
export function horizontalLines(mask: Plane): Plane {
  return openRows(closeRows(mask, 9), Math.max(Math.trunc(mask.width / 20), 10));
}

// ---------------------------------------------------------------------------
// Orientation and skew

/** Fraction of the image covered by long horizontal strokes. */
export function lineScore(mask: Plane): number {
  return fraction(horizontalLines(mask));
}

function rotateMask(mask: Plane, degrees: number): Plane {
  return { ...mask, data: rotateSmall(mask.data, mask.width, mask.height, degrees) };
}

/**
 * Counter-clockwise angle that makes the staff lines horizontal: the one
 * maximizing the sharpness (sum of squares) of the row profile of the
 * long-stroke mask, on a downscaled copy for speed.
 */
export function estimateSkew(mask: Plane, maxDegrees = 2, step = 0.05): number {
  const lines = horizontalLines(mask);
  const scaled = { ...lines, data: lines.data.map((v) => v * 255) };
  const small = resizeArea(scaled, 1000 / Math.max(lines.width, lines.height));
  let best = 0;
  let bestScore = -1;
  const steps = Math.round((2 * maxDegrees) / step);
  for (let i = 0; i <= steps; i++) {
    const angle = -maxDegrees + i * step;
    const rotated = rotateSmall(small.data, small.width, small.height, angle);
    let score = 0;
    for (let y = 0; y < small.height; y++) {
      let row = 0;
      for (let x = 0; x < small.width; x++) row += rotated[y * small.width + x]!;
      score += row * row;
    }
    if (score > bestScore) {
      best = angle;
      bestScore = score;
    }
  }
  return Math.round(best * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Staff lines and systems

function rowRuns(profile: number[], threshold: number): number[] {
  const centers: number[] = [];
  let y = 0;
  while (y < profile.length) {
    if (profile[y]! < threshold) {
      y++;
      continue;
    }
    let end = y;
    while (end < profile.length && profile[end]! >= threshold) end++;
    centers.push((y + end - 1) / 2);
    y = end;
  }
  return centers;
}

/**
 * Trace staff lines across vertical strips so bent lines stay whole. Each
 * strip yields the rows where a line crosses most of it; points of
 * neighboring strips are linked into tracks when they are close in y. Only
 * tracks spanning at least a third of the page width are kept.
 */
export function findLines(linesMask: Plane, ink: Plane | null = null, strips = 8, minCoverage = 0.5): Line[] {
  const { width, height, data } = linesMask;
  const edges = Array.from({ length: strips + 1 }, (_, i) => Math.trunc((i * width) / strips));
  let points: number[][] = [];
  for (let i = 0; i < strips; i++) {
    const x0 = edges[i]!;
    const x1 = edges[i + 1]!;
    const profile = new Array<number>(height).fill(0);
    for (let y = 0; y < height; y++) {
      let n = 0;
      for (let x = x0; x < x1; x++) n += data[y * width + x]!;
      profile[y] = n;
    }
    points.push(rowRuns(profile, minCoverage * (x1 - x0)));
  }

  const allDiffs = points.filter((p) => p.length > 1).flatMap(diff);
  if (allDiffs.length === 0) return [];
  const small = [...allDiffs].sort((p, q) => p - q).slice(0, Math.max(1, allDiffs.length >> 1));
  const link = 0.45 * median(small);

  points = points.map((p) => mergeCloseValues(p, link));
  const stripWidth = edges[1]! - edges[0]!;
  const tracks: [number, number][][] = [];
  points.forEach((ys, i) => {
    const x = (edges[i]! + edges[i + 1]!) / 2;
    const taken = new Set<number>();
    for (const y of ys) {
      let best: number | null = null;
      let bestD = link;
      tracks.forEach((track, t) => {
        const last = track[track.length - 1]!;
        if (taken.has(t) || x - last[0] > 3 * stripWidth) return;
        const d = Math.abs(last[1] - y);
        if (d < bestD) {
          best = t;
          bestD = d;
        }
      });
      if (best === null) {
        tracks.push([[x, y]]);
        taken.add(tracks.length - 1);
      } else {
        tracks[best]!.push([x, y]);
        taken.add(best);
      }
    }
  });

  const result: Line[] = [];
  for (const track of mergeParallelTracks(tracks, link)) {
    const line: Line = { xs: track.map((p) => p[0]), ys: track.map((p) => p[1]), left: 0, right: 0 };
    [line.left, line.right] = lineExtent(linesMask, line, ink);
    if (line.right - line.left >= width / 3) result.push(line);
  }
  return result.sort((a, b) => midY(a) - midY(b));
}

/** Collapse runs of one thick line that were split into nearby centers. */
function mergeCloseValues(values: number[], distance: number): number[] {
  const groups: number[][] = [];
  for (const v of [...values].sort((p, q) => p - q)) {
    const last = groups[groups.length - 1];
    if (last && v - last[last.length - 1]! < distance) last.push(v);
    else groups.push([v]);
  }
  return groups.map(mean);
}

/** Join tracks that follow the same line (e.g. split around a gap). */
function mergeParallelTracks(tracks: [number, number][][], distance: number): [number, number][][] {
  const sorted = [...tracks].sort((a, b) => median(a.map((p) => p[1])) - median(b.map((p) => p[1])));
  const merged: [number, number][][] = [];
  for (const track of sorted) {
    const prev = merged[merged.length - 1];
    if (prev) {
      const xs = [...new Set([...prev, ...track].map((p) => p[0]))].sort((a, b) => a - b);
      const prevX = prev.map((p) => p[0]);
      const prevY = prev.map((p) => p[1]);
      const trackX = track.map((p) => p[0]);
      const trackY = track.map((p) => p[1]);
      const gap = median(xs.map((x) => Math.abs(interp(x, prevX, prevY) - interp(x, trackX, trackY))));
      if (gap < distance) {
        const byX = new Map<number, number[]>();
        for (const [x, y] of [...prev, ...track]) byX.set(x, [...(byX.get(x) ?? []), y]);
        merged[merged.length - 1] = [...byX.entries()].sort((a, b) => a[0] - b[0]).map(([x, ys]) => [x, mean(ys)]);
        continue;
      }
    }
    merged.push(track);
  }
  return merged;
}

/**
 * Leftmost and rightmost x of the line. The core comes from the long-stroke
 * mask; it is then extended along the raw ink, because the ends of staff
 * lines touch the clef letters and short pieces there do not survive the
 * long-stroke filter.
 */
function lineExtent(linesMask: Plane, line: Line, ink: Plane | null, band = 3, maxGap = 4): [number, number] {
  const { width, height } = linesMask;
  const ys = Array.from({ length: width }, (_, x) => Math.round(lineY(line, x)));
  const along = (mask: Plane): Uint8Array => {
    const hit = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      for (let dy = -band; dy <= band; dy++) {
        const y = Math.min(Math.max(ys[x]! + dy, 0), height - 1);
        if (mask.data[y * width + x]) {
          hit[x] = 1;
          break;
        }
      }
    }
    return hit;
  };
  const core = along(linesMask);
  const cols: number[] = [];
  core.forEach((v, x) => v && cols.push(x));
  if (cols.length === 0) return [0, 0];
  let left = Math.trunc(percentile(cols, 0.5));
  let right = Math.trunc(percentile(cols, 99.5));
  if (ink) {
    const raw = along(ink);
    left = extend(raw, left, -1, maxGap);
    right = extend(raw, right, 1, maxGap);
  }
  return [left, right];
}

/** Walk from `start` while `hit` stays set, tolerating short gaps. */
function extend(hit: Uint8Array, start: number, step: number, maxGap: number): number {
  let end = start;
  let gap = 0;
  let x = start;
  while (x + step >= 0 && x + step < hit.length) {
    x += step;
    if (hit[x]) {
      end = x;
      gap = 0;
    } else if (++gap > maxGap) {
      break;
    }
  }
  return end;
}

/** Group lines into staves of evenly spaced lines. */
export function groupStaves(lines: Line[]): Staff[] {
  if (lines.length < 2) return [];
  const mids = lines.map(midY);
  const gaps = diff(mids);
  const spacing = median([...gaps].sort((a, b) => a - b).slice(0, Math.max(1, gaps.length >> 1)));
  const groups: Line[][] = [[lines[0]!]];
  lines.slice(1).forEach((line, i) => {
    if (gaps[i]! < 1.6 * spacing) groups[groups.length - 1]!.push(line);
    else groups.push([line]);
  });
  return groups.map(cleanGroup).filter((g) => g.length >= 4).map((g) => ({ lines: g }));
}

/**
 * Drop stray strokes (long beams, underlines) caught in a staff group: staff
 * lines share their extent, so clearly shorter lines are removed; if more
 * than six remain, the six most evenly spaced are kept.
 */
function cleanGroup(group: Line[]): Line[] {
  const longest = Math.max(...group.map((l) => l.right - l.left));
  const lines = group.filter((l) => l.right - l.left >= 0.7 * longest);
  if (lines.length <= 6) return lines;
  let best = lines.slice(0, 6);
  let bestVar = Infinity;
  for (let i = 0; i + 6 <= lines.length; i++) {
    const window = lines.slice(i, i + 6);
    const d = diff(window.map(midY));
    const m = mean(d);
    const v = mean(d.map((x) => (x - m) ** 2));
    if (v < bestVar) {
      best = window;
      bestVar = v;
    }
  }
  return best;
}

/**
 * Whether each group is a TAB or a standard staff. Normally by its line
 * count (6 or 5), but chord names written on a staff line can hide part of
 * it, leaving 4 or 5 lines. TAB paper spaces the TAB lines wider than the
 * staff lines, so when the full groups of a page show two clearly
 * different spacings, every group is classified by the nearer one.
 */
function staffKinds(staves: Staff[]): ("tab" | "staff")[] {
  const byCount = staves.map((st) => (st.lines.length === 6 ? "tab" : "staff") as "tab" | "staff");
  const sixSpacing = median(staves.filter((st) => st.lines.length === 6).map(staffSpacing));
  const fiveSpacing = median(staves.filter((st) => st.lines.length === 5).map(staffSpacing));
  if (!(sixSpacing > 0 && fiveSpacing > 0) || sixSpacing / fiveSpacing < 1.12) return byCount;
  const split = Math.sqrt(sixSpacing * fiveSpacing);
  return staves.map((st) => (staffSpacing(st) >= split ? "tab" : "staff"));
}

/**
 * Pair each TAB with its own standard staff: the nearer of the 5-line
 * staves directly above and below (the gap to the neighboring system is
 * larger than the gap inside a system). Also reports whether the page looks
 * upside down, i.e. most TABs have their own staff below them.
 */
export function buildSystems(staves: Staff[]): { systems: System[]; upsideDown: boolean } {
  const systems: System[] = [];
  let above = 0;
  let below = 0;
  const used = new Set<number>();
  const kinds = staffKinds(staves);
  staves.forEach((st, i) => {
    if (kinds[i] !== "tab") return;
    const system: System = { tab: st, staff: null, barlines: [] };
    const limit = 12 * staffSpacing(st);
    const prev = staves[i - 1];
    const next = staves[i + 1];
    const gapAbove = prev && kinds[i - 1] === "staff" ? staffTop(st) - staffBottom(prev) : null;
    const gapBelow = next && kinds[i + 1] === "staff" ? staffTop(next) - staffBottom(st) : null;
    if (gapAbove !== null && gapAbove < limit && (gapBelow === null || gapAbove <= gapBelow)) {
      system.staff = prev!;
      used.add(i - 1);
      above++;
    } else if (gapBelow !== null && gapBelow < limit) {
      used.add(i + 1);
      below++;
    }
    systems.push(system);
  });
  // Groups that are neither a TAB nor a staff paired with one: a TAB with a
  // missed line. Keep them as TABs so their measures are not lost.
  staves.forEach((st, i) => {
    if (kinds[i] !== "tab" && !used.has(i)) systems.push({ tab: st, staff: null, barlines: [] });
  });
  systems.sort((a, b) => systemTop(a) - systemTop(b));
  return { systems, upsideDown: below > above };
}

// ---------------------------------------------------------------------------
// Bar lines

/** Whether a stroke covers most of the rows y0..y1 of a column. */
function covered(column: Uint8Array, y0: number, y1: number, ratio = 0.6): boolean {
  const lo = Math.max(Math.trunc(y0), 0);
  const hi = Math.min(Math.trunc(y1), column.length - 1);
  if (hi <= lo) return false;
  let n = 0;
  for (let y = lo; y <= hi; y++) n += column[y]!;
  return n / (hi - lo + 1) >= ratio;
}

function columnOf(mask: Plane, x0: number, x1: number): Uint8Array {
  const column = new Uint8Array(mask.height);
  const lo = Math.max(x0, 0);
  const hi = Math.min(x1, mask.width - 1);
  for (let y = 0; y < mask.height; y++) {
    for (let x = lo; x <= hi; x++) {
      if (mask.data[y * mask.width + x]) {
        column[y] = 1;
        break;
      }
    }
  }
  return column;
}

/**
 * x positions of bar lines crossing the whole TAB of a system. A bar line
 * covers the TAB from its top to its bottom line and, unlike note stems,
 * does not continue below it; on staff + TAB paper it must also cross the
 * staff, which rejects stems and boxed labels confined to the TAB. The TAB
 * edges are followed per column, so bent lines are handled. `strokes` is the
 * vertical ink combined with the staff lines, so crossing a staff line does
 * not interrupt a bar line.
 */
export function findBarlines(strokes: Plane, system: System, content: Plane | null = null): number[] {
  const s = systemSpacing(system);
  if (!(s > 0)) return [];
  // Tolerate slightly slanted hand-drawn lines by widening strokes first.
  const widened = dilateRows(strokes, 2);
  const { width } = widened;
  const left = systemLeft(system);
  const right = systemRight(system);
  const candidates: number[] = [];
  for (let x = left; x <= right; x++) {
    const t = Math.round(staffTopAt(system.tab, x));
    const b = Math.round(staffBottomAt(system.tab, x));
    if (b <= t) continue;
    let n = 0;
    for (let y = t; y <= b; y++) n += widened.data[y * width + x]!;
    if (n / (b - t + 1) >= 0.9) candidates.push(x);
  }

  const accepted: number[] = [];
  for (const cluster of clusters(candidates, 2)) {
    const x = Math.round(mean(cluster));
    const tabTop = staffTopAt(system.tab, x);
    const tabBottom = staffBottomAt(system.tab, x);
    // A stroke continues past the TAB when most of its columns do; a note
    // stem right next to a bar line only affects a few of them.
    const continues = (y0: number, y1: number): boolean =>
      cluster.filter((cx) => covered(columnOf(widened, cx, cx), y0, y1)).length >= cluster.length / 2;
    if (continues(tabBottom + 0.3 * s, tabBottom + 1.2 * s)) continue; // a stem below the TAB
    const staff = system.staff;
    if (staff) {
      // Search a little sideways: printed bar lines are often slightly
      // slanted, so the staff part is offset from the TAB part.
      const reach = Math.max(Math.trunc(0.5 * s), 2);
      let crosses = false;
      for (let xx = Math.max(x - reach, 0); xx <= Math.min(x + reach, width - 1) && !crosses; xx++) {
        crosses = covered(columnOf(widened, xx, xx), staffTopAt(staff, xx), staffBottomAt(staff, xx));
      }
      if (!crosses) continue;
    } else if (continues(tabTop - 1.2 * s, tabTop - 0.3 * s)) {
      continue; // a stem above the TAB
    }
    // Ovals drawn around stacked chords: curved, and closed. (A parenthesis
    // is curved too, but some writers use one as the measure boundary.)
    if (content) {
      const bend = Math.min(...cluster.map((cx) => strokeBend(strokes, cx, tabTop, tabBottom)));
      if (bend > MAX_BEND * s && closedLoop(content, x, tabTop, tabBottom, s)) continue;
    }
    accepted.push(x);
  }
  const edge = 1.5 * s; // the lines closing the system at both ends are not inner bar lines
  return mergeClose(accepted, 1.2 * s).filter((x) => left + edge < x && x < right - edge);
}

/**
 * Largest bend of a bar line, in staff spacings (see strokeBend). Measured
 * on real scans: bar lines bend up to 0.11; parentheses (0.13 to 0.21) and
 * ovals around stacked chords (0.19 to 0.26) bend more.
 */
export const MAX_BEND = 0.12;

/**
 * How far a stroke bends away from a straight line between rows y0..y1, in
 * pixels: the stroke is followed row by row from its middle (one pixel
 * sideways at most per row), then a line is fitted to its positions. Ruled
 * or hand-drawn bar lines stay close to straight even when slanted;
 * parentheses and the ovals drawn around stacked chords bulge.
 */
export function strokeBend(strokes: Plane, x: number, y0: number, y1: number): number {
  const { width, data } = strokes;
  const top = Math.max(Math.round(y0), 0);
  const bottom = Math.min(Math.round(y1), strokes.height - 1);
  if (bottom - top < 4) return 0;
  const mid = (top + bottom) >> 1;
  const ink = (xx: number, y: number) => xx >= 0 && xx < width && data[y * width + xx] === 1;
  // Start on the ink nearest to x in the middle row.
  let start = x;
  for (let d = 0; d <= 3; d++) {
    if (ink(x - d, mid)) {
      start = x - d;
      break;
    }
    if (ink(x + d, mid)) {
      start = x + d;
      break;
    }
  }
  const xs = new Map<number, number>();
  for (const step of [-1, 1]) {
    let at = start;
    for (let y = mid; step < 0 ? y >= top : y <= bottom; y += step) {
      // Follow the edge facing x's side: a stroke crossing a staff line
      // meets a long horizontal run, so prefer staying put.
      if (ink(at, y)) {
        xs.set(y, at);
      } else if (ink(at - 1, y)) {
        xs.set(y, --at);
      } else if (ink(at + 1, y)) {
        xs.set(y, ++at);
      }
    }
  }
  if (xs.size < (bottom - top) / 2) return Infinity; // not one connected stroke
  const ys = [...xs.keys()];
  const vs = [...xs.values()];
  const my = mean(ys);
  const mx = mean(vs);
  let sxy = 0;
  let syy = 0;
  ys.forEach((y, i) => {
    sxy += (y - my) * (vs[i]! - mx);
    syy += (y - my) ** 2;
  });
  const slope = syy ? sxy / syy : 0;
  return Math.max(...ys.map((y, i) => Math.abs(vs[i]! - (mx + slope * (y - my)))));
}

/**
 * Whether the stroke at x is one side of a closed loop, such as an oval
 * drawn around a stacked chord: following its ink (staff lines removed,
 * small gaps bridged) reaches a second side at least 0.8 spacings away
 * that runs along much of the TAB. A parenthesis is one open arc, and the
 * digits next to it are too short to count as a side.
 */
export function closedLoop(content: Plane, x: number, top: number, bottom: number, s: number): boolean {
  const x0 = Math.max(Math.round(x - 3 * s), 0);
  const x1 = Math.min(Math.round(x + 3 * s), content.width - 1);
  const y0 = Math.max(Math.round(top - s), 0);
  const y1 = Math.min(Math.round(bottom + s), content.height - 1);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  if (w < 3 || h < 3) return false;
  // Local copy, dilated by 2 px to bridge the gaps where staff lines crossed.
  const local = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let xx = 0; xx < w; xx++) {
      if (!content.data[(y0 + y) * content.width + x0 + xx]) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const yy = y + dy;
          const xd = xx + dx;
          if (yy >= 0 && yy < h && xd >= 0 && xd < w) local[yy * w + xd] = 1;
        }
      }
    }
  }
  // Seed on the stroke near x, around the middle of the TAB.
  const cx = Math.round(x) - x0;
  const mid = Math.round((top + bottom) / 2) - y0;
  let seed = -1;
  for (let dy = 0; dy <= Math.round(s) && seed < 0; dy++) {
    for (const y of [mid - dy, mid + dy]) {
      for (let dx = 0; dx <= 3 && seed < 0; dx++) {
        for (const xx of [cx - dx, cx + dx]) {
          if (seed < 0 && y >= 0 && y < h && xx >= 0 && xx < w && local[y * w + xx]) seed = y * w + xx;
        }
      }
    }
  }
  if (seed < 0) return false;
  const seen = new Uint8Array(w * h);
  const stack = [seed];
  seen[seed] = 1;
  const rowsAt = new Map<number, Set<number>>(); // column → rows with ink
  while (stack.length) {
    const i = stack.pop()!;
    const px = i % w;
    const py = (i - px) / w;
    let rows = rowsAt.get(px);
    if (!rows) rowsAt.set(px, (rows = new Set()));
    rows.add(py);
    for (const [nx, ny] of [
      [px - 1, py],
      [px + 1, py],
      [px, py - 1],
      [px, py + 1],
    ] as const) {
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const j = ny * w + nx;
      if (local[j] && !seen[j]) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  const columns = [...rowsAt.keys()];
  const minX = Math.min(...columns);
  const maxX = Math.max(...columns);
  if (maxX - minX < 0.8 * s) return false;
  // The far side from the stroke must run along much of the TAB.
  const band = Math.max(Math.round(0.3 * s), 2);
  const [lo, hi] = cx - minX < maxX - cx ? [maxX - band, maxX] : [minX, minX + band];
  const rows = new Set<number>();
  for (let c = lo; c <= hi; c++) for (const r of rowsAt.get(c) ?? []) rows.add(r);
  return rows.size >= 0.4 * (bottom - top);
}

function clusters(xs: number[], maxGap: number): number[][] {
  const out: number[][] = [];
  for (const x of xs) {
    const last = out[out.length - 1];
    if (last && x - last[last.length - 1]! <= maxGap) last.push(x);
    else out.push([x]);
  }
  return out;
}

/** Merge double bar lines and repeat signs into a single boundary. */
function mergeClose(xs: number[], distance: number): number[] {
  return clusters([...xs].sort((a, b) => a - b), distance).map((g) => Math.round(mean(g)));
}

/**
 * Horizontal [x0, x1] spans of the measures of a system, left to right.
 * Spans narrower than `minWidth` staff spacings (e.g. the clef area before
 * a start-repeat bar line) cannot hold a measure; they are merged into their
 * neighbor so the regions still cover the whole system.
 */
export function measureSpans(system: System, minWidth = 5): [number, number][] {
  const s = systemSpacing(system);
  const left = systemLeft(system);
  const right = systemRight(system);
  const bounds = mergeClose([left, ...system.barlines, right], 1.5 * s);
  bounds[0] = Math.min(bounds[0]!, left);
  bounds[bounds.length - 1] = Math.max(bounds[bounds.length - 1]!, right);
  while (bounds.length > 2) {
    const widths = diff(bounds);
    const i = widths.indexOf(Math.min(...widths));
    if (widths[i]! >= minWidth * s) break;
    // Drop the inner bound shared with the narrower neighbor.
    if (i === 0) bounds.splice(1, 1);
    else if (i === widths.length - 1) bounds.splice(bounds.length - 2, 1);
    else if (widths[i - 1]! <= widths[i + 1]!) bounds.splice(i, 1);
    else bounds.splice(i + 1, 1);
  }
  return bounds.slice(1).map((b, i) => [bounds[i]!, b]);
}

// ---------------------------------------------------------------------------
// Page level

function detectUpright(mask: Plane) {
  return buildSystems(groupStaves(findLines(horizontalLines(mask), mask)));
}

/**
 * Detect orientation, skew, systems and bar lines of a rendered page. A page
 * without staff lines yields a layout with no systems.
 */
export function analyzePage(image: RgbaImage): PageLayout {
  const { gray, saturation } = grayAndSaturation(image);
  let mask = inkMask(gray, saturation);
  let rotation = lineScore(mask) >= lineScore(rotatePlane90(mask, 90)) ? 0 : 90;
  mask = rotatePlane90(mask, rotation);
  const skew = estimateSkew(mask);
  mask = rotateMask(mask, skew);
  let { systems, upsideDown } = detectUpright(mask);
  if (systems.length === 0) return { rotation, skew, width: mask.width, height: mask.height, systems };
  if (upsideDown || (!systems.some((s) => s.staff) && tabLabelsOnRight(mask, systems))) {
    rotation += 180;
    mask = rotatePlane90(mask, 180);
    ({ systems } = detectUpright(mask));
  }
  const upright = (p: Plane): Plane => {
    const turned = rotatePlane90(p, rotation);
    return { ...turned, data: rotateSmall(turned.data, turned.width, turned.height, skew, 1, 255) };
  };
  const lines = horizontalLines(mask);
  const strokes = or(verticalInk(upright(gray), upright(saturation)), lines);
  const content = subtract(mask, lines);
  for (const system of systems) system.barlines = findBarlines(strokes, system, content);
  return { rotation: rotation % 360, skew, width: mask.width, height: mask.height, systems };
}

/**
 * For TAB-only pages: is the printed "TAB" clef at the right end? The clef
 * letters sit just inside the left edge of an upright TAB; at the right edge
 * there is at most a bar line. Staff lines are removed first.
 */
function tabLabelsOnRight(mask: Plane, systems: System[]): boolean {
  const content = subtract(mask, horizontalLines(mask));
  const windowMean = (x0: number, x1: number, y0: number, y1: number): number => {
    let n = 0;
    let count = 0;
    for (let y = Math.max(y0, 0); y < Math.min(y1, content.height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x1, content.width); x++) {
        n += content.data[y * content.width + x]!;
        count++;
      }
    }
    return count ? n / count : 0;
  };
  let votes = 0;
  for (const system of systems) {
    const s = systemSpacing(system);
    const top = Math.trunc(Math.min(...system.tab.lines[0]!.ys));
    const bottom = Math.trunc(Math.max(...system.tab.lines[system.tab.lines.length - 1]!.ys));
    const inner = Math.trunc(0.4 * s);
    const w = Math.trunc(2.5 * s);
    const left = systemLeft(system);
    const right = systemRight(system);
    const l = windowMean(left + inner, left + inner + w, top, bottom);
    const r = windowMean(right - inner - w, right - inner, top, bottom);
    votes += r > l ? 1 : -1;
  }
  return votes > 0;
}

/** The rendered page turned upright (rotation + deskew), e.g. for overlays. */
export function uprightImage(image: RgbaImage, layout: Pick<PageLayout, "rotation" | "skew">): RgbaImage {
  const turned = rotate90(image.data, image.width, image.height, layout.rotation, 4);
  const data = rotateSmall(turned.data, turned.width, turned.height, layout.skew, 4, 255);
  return { width: turned.width, height: turned.height, data };
}

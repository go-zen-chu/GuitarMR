/** Synthetic score pages for tests: staff paper drawn with Canvas 2D. */

import { createCanvas } from "@napi-rs/canvas";
import { type RgbaImage, rotate90, rotateSmall } from "../src/image.ts";

export const WIDTH = 2122;
export const HEIGHT = 3000;
export const LEFT = 90;
export const RIGHT = 2030;
export const SPACING = 18;
const INK = "rgb(90, 90, 90)";
const RED = "rgb(220, 40, 40)";
const PAPER = 250;

export interface SystemSpec {
  top: number; // y of the first line of the system
  barlines: number[]; // inner bar line x positions
  withStaff?: boolean;
  stems?: number[]; // x of note stems hanging below the TAB
  redLines?: number[]; // x of red pen strokes across the TAB
  ovals?: number[]; // x of ovals drawn around stacked chords on the TAB
  parens?: number[]; // x of "(" drawn instead of a bar line (a measure boundary)
  tabSpacing?: number; // TAB line spacing, when wider than the staff's
  staffTopFrom?: number; // the top staff line is hidden left of this x (chord names written on it)
  tabTopFrom?: number; // the same for the top TAB line
}

export const tabTop = (spec: SystemSpec): number =>
  spec.top + ((spec.withStaff ?? true) ? 4 * SPACING + 5 * SPACING : 0);

export function drawPage(systems: SystemSpec[]): RgbaImage {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${PAPER}, ${PAPER}, ${PAPER})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  const line = (x0: number, y0: number, x1: number, y1: number, color: string, width: number) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  };
  for (const spec of systems) {
    const withStaff = spec.withStaff ?? true;
    const tTop = tabTop(spec);
    const tabSpacing = spec.tabSpacing ?? SPACING;
    const tBottom = tTop + 5 * tabSpacing;
    if (withStaff) {
      for (let i = 0; i < 5; i++) {
        const from = i === 0 ? (spec.staffTopFrom ?? LEFT) : LEFT;
        line(from, spec.top + i * SPACING, RIGHT, spec.top + i * SPACING, INK, 2);
      }
    }
    for (let i = 0; i < 6; i++) {
      const from = i === 0 ? (spec.tabTopFrom ?? LEFT) : LEFT;
      line(from, tTop + i * tabSpacing, RIGHT, tTop + i * tabSpacing, INK, 2);
    }
    // "TAB" clef letters just inside the left edge.
    ctx.fillStyle = "rgb(30, 30, 30)";
    ctx.font = "bold 30px sans-serif";
    [..."TAB"].forEach((letter, i) => ctx.fillText(letter, LEFT + 8, tTop + 24 + i * 30));
    const top = withStaff ? spec.top : tTop;
    for (const x of [LEFT, ...spec.barlines, RIGHT]) line(x, top, x, tBottom, INK, 2);
    for (const x of spec.stems ?? []) {
      // A stem from a note on the top string down to a beam under the TAB.
      line(x, tTop - 2, x, tBottom + 3 * SPACING, INK, 2);
      line(x, tBottom + 3 * SPACING, x + 60, tBottom + 3 * SPACING, INK, 4);
    }
    for (const x of spec.redLines ?? []) line(x, tTop - 10, x, tBottom + 10, RED, 3);
    for (const x of spec.ovals ?? []) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, (tTop + tBottom) / 2, 0.7 * tabSpacing, 3 * tabSpacing, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
    for (const x of spec.parens ?? []) {
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x + 0.7 * tabSpacing, (tTop + tBottom) / 2, 0.7 * tabSpacing, 3 * tabSpacing, 0, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.stroke();
    }
    // Chord names above the system.
    ctx.fillStyle = "rgb(30, 30, 30)";
    ctx.font = "40px sans-serif";
    ctx.fillText("Am7", LEFT + 40, top - 30);
  }
  const data = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  return { width: WIDTH, height: HEIGHT, data: data.data };
}

/** Five systems of four measures each, `gap` line spacings apart. */
export function standardPage(withStaff = true, gap = 16): { page: RgbaImage; specs: SystemSpec[] } {
  const height = withStaff ? 14 * SPACING : 5 * SPACING;
  const step = height + gap * SPACING;
  const specs = Array.from({ length: 5 }, (_, i) => ({ top: 300 + i * step, barlines: [575, 1060, 1545], withStaff }));
  return { page: drawPage(specs), specs };
}

/** The page turned clockwise by a multiple of 90 degrees, as a scan might come in. */
export function turn(image: RgbaImage, clockwise: number): RgbaImage {
  const r = rotate90(image.data, image.width, image.height, clockwise, 4);
  return { width: r.width, height: r.height, data: r.data };
}

/** Skew counter-clockwise by a small angle. */
export function skew(image: RgbaImage, degrees: number): RgbaImage {
  return { ...image, data: rotateSmall(image.data, image.width, image.height, degrees, 4, PAPER) };
}

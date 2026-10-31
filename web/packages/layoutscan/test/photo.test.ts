import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createCanvas } from "@napi-rs/canvas";
import type { RgbaImage } from "../src/image.ts";
import {
  type Point,
  type Quad,
  convexHull,
  correctPhoto,
  findPaper,
  flattenLighting,
  largestQuad,
  orderCorners,
  otsu,
  paperAspect,
  quadToSquare,
  squareToQuad,
  warpPaper,
} from "../src/photo.ts";

const near = (actual: number, expected: number, tolerance: number, what = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what} ${actual} is not within ${tolerance} of ${expected}`);

/** A photo of a white sheet (corners `quad`) with ruled ink lines on a dark desk. */
function photoOf(quad: Quad, width = 1200, height = 1600, desk = "rgb(70, 60, 50)"): RgbaImage {
  const ctx = createCanvas(width, height).getContext("2d");
  ctx.fillStyle = desk;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "rgb(235, 232, 225)";
  ctx.beginPath();
  quad.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fill();
  // Staff-like lines running edge to edge across the sheet.
  const map = squareToQuad(quad);
  ctx.strokeStyle = "rgb(40, 40, 40)";
  ctx.lineWidth = 2;
  for (let v = 0.1; v < 0.95; v += 0.02) {
    ctx.beginPath();
    ctx.moveTo(...map(0, v));
    ctx.lineTo(...map(1, v));
    ctx.stroke();
  }
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data };
}

/**
 * Pinhole projection of a w x h sheet at distance d, tilted about the x
 * axis and then turned about the y axis (degrees), focal length f, center c.
 */
function project(w: number, h: number, tilt: number, turn: number, d: number, f: number, c: Point): Quad {
  const a = (tilt * Math.PI) / 180;
  const b = (turn * Math.PI) / 180;
  return [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ].map(([x, y]) => {
    const Y = y! * Math.cos(a);
    const z = y! * Math.sin(a);
    const X = x! * Math.cos(b) + z * Math.sin(b);
    const Z = -x! * Math.sin(b) + z * Math.cos(b) + d;
    return [c[0] + (f * X) / Z, c[1] + (f * Y) / Z];
  }) as Quad;
}

describe("photo correction", () => {
  it("If gray values form two groups otsu should split between them", () => {
    const gray = new Uint8Array(1000).map((_, i) => (i % 3 ? 200 + (i % 7) : 40 + (i % 5)));
    const t = otsu(gray);
    assert.ok(t > 44 && t <= 200, `${t}`);
  });

  it("If points lie on and inside a rotated rectangle the largest quad should be its corners", () => {
    const corners: Point[] = [
      [100, 50],
      [400, 120],
      [350, 520],
      [40, 440],
    ];
    const points: Point[] = [...corners];
    for (let i = 0; i < 4; i++) {
      const [a, b] = [corners[i]!, corners[(i + 1) % 4]!];
      for (let t = 0.1; t < 0.95; t += 0.1) points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
    points.push([200, 300], [250, 250]);
    assert.deepEqual(orderCorners(largestQuad(convexHull(points))), corners);
  });

  it("If a point is mapped to the quad and back it should return to where it started", () => {
    const quad: Quad = [
      [120, 80],
      [900, 140],
      [1000, 1300],
      [60, 1250],
    ];
    const there = squareToQuad(quad);
    const back = quadToSquare(quad);
    assert.deepEqual(there(0, 0), [120, 80]);
    for (const [u, v] of [
      [0.3, 0.7],
      [1, 1],
      [0.5, 0.01],
    ] as const) {
      const [x, y] = there(u, v);
      const [bu, bv] = back(x, y);
      near(bu, u, 1e-9);
      near(bv, v, 1e-9);
    }
  });

  it("If an A4 sheet is photographed at an angle its aspect should come back from the perspective", () => {
    const c: Point = [1134, 1512];
    const diagonal = 3780;
    // Tilted and turned: the focal length is solved, even for a zoomed-in photo.
    for (const [tilt, turn, f] of [
      [-25, 10, 2268],
      [20, -15, 2268],
      [-20, 12, 4500],
    ] as const) {
      near(paperAspect(project(210, 297, tilt, turn, 400, f, c), c, diagonal), 210 / 297, 0.005, `${tilt} ${turn} ${f}`);
    }
    // Only tilted: a phone's usual focal length is assumed.
    for (const tilt of [-30, -10, 25]) {
      near(paperAspect(project(210, 297, tilt, 0, 400, 0.6 * diagonal, c), c, diagonal), 210 / 297, 0.005, `tilt ${tilt}`);
    }
    // Facing the sheet squarely there is no perspective at all.
    near(paperAspect(project(300, 200, 0, 0, 400, 2700, c), c, diagonal), 1.5, 1e-6);
  });

  it("If a sheet lies on a darker desk findPaper should return its corners", () => {
    const quad: Quad = [
      [210, 260],
      [1010, 190],
      [1100, 1480],
      [120, 1420],
    ];
    const paper = findPaper(photoOf(quad));
    assert.ok(paper);
    paper.forEach(([x, y], i) => {
      near(x, quad[i]![0], 4, `corner ${i} x`);
      near(y, quad[i]![1], 4, `corner ${i} y`);
    });
  });

  it("If no large bright area is in the photo findPaper should return null", () => {
    const tiny: Quad = [
      [500, 700],
      [600, 700],
      [600, 800],
      [500, 800],
    ];
    assert.equal(findPaper(photoOf(tiny)), null);
  });

  it("If the photo has no sheet correctPhoto should still scale it and flatten the light", () => {
    const tiny: Quad = [
      [500, 700],
      [600, 700],
      [600, 800],
      [500, 800],
    ];
    const { image, paper } = correctPhoto(photoOf(tiny), 800);
    assert.equal(paper, null);
    assert.deepEqual([image.width, image.height], [600, 800]);
  });

  it("If a sheet is cut out its lines should run straight across the page", () => {
    const quad: Quad = [
      [210, 260],
      [1010, 190],
      [1100, 1480],
      [120, 1420],
    ];
    const page = warpPaper(photoOf(quad), quad, 1000, false);
    // The ruled line at v = 0.5 sits on the same row at the left, middle and right.
    const darkest = (x: number): number => {
      let best = 0;
      let row = -1;
      for (let y = 490; y < 510; y++) {
        const v = 255 - page.data[(y * page.width + x) * 4]!;
        if (v > best) [best, row] = [v, y];
      }
      return row;
    };
    const rows = [0.1, 0.5, 0.9].map((u) => darkest(Math.round(u * page.width)));
    assert.ok(Math.max(...rows) - Math.min(...rows) <= 1, `${rows}`);
  });

  it("If light falls off across the sheet flattening should make the paper white and keep the ink dark", () => {
    const width = 600;
    const height = 800;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const light = 1 - (0.45 * x) / width; // 245 at the left, ~135 at the right
        const ink = y % 40 < 2 ? 0.3 : 1;
        const i = (y * width + x) * 4;
        data[i] = 245 * light * ink;
        data[i + 1] = 235 * light * ink;
        data[i + 2] = 205 * light * ink; // warm light
        data[i + 3] = 255;
      }
    }
    const flat = flattenLighting({ width, height, data });
    for (const x of [20, 300, 580]) {
      const paper = (20 * width + x) * 4;
      const line = (40 * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        assert.ok(flat.data[paper + c]! >= 250, `paper at ${x}: ${flat.data[paper + c]}`);
        assert.ok(flat.data[line + c]! <= 100, `ink at ${x}: ${flat.data[line + c]}`);
      }
    }
  });
});

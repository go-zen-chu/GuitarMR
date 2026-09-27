/**
 * Engrave a gts document onto staff + TAB paper.
 *
 * It draws what the structure, chords, tab and lyrics layers say (boxed
 * section labels, repeat and final bars, volta brackets, chord names, fret
 * numbers, stems, lyrics inside the staff) and returns where it drew every
 * measure, so layout detection can be checked against the truth.
 *
 * Japanese text needs a CJK font (see findJapaneseFont).
 */

import { existsSync } from "node:fs";
import { GlobalFonts, type SKRSContext2D, createCanvas } from "@napi-rs/canvas";
import type { GtsDocument, Measure } from "@guitarmr/gts";
import type { RgbaImage } from "@guitarmr/layoutscan";
import { PAPER } from "./scan.ts";

export const WIDTH = 2122;
export const HEIGHT = 3000;
export const LEFT = 150;
export const RIGHT = 1970;
export const SPACING = 18;
export const FIRST_SYSTEM_TOP = 420;
const SYSTEM_GAP = 16 * SPACING; // from TAB bottom line to the next staff top line
const STAFF_TO_TAB = 5 * SPACING; // from staff bottom line to TAB top line
export const MEASURES_PER_SYSTEM = 4;
const CLEF_WIDTH = 70; // room for the "TAB" clef before the first beat

const PAPER_CSS = `rgb(${PAPER.join(",")})`;
const PENCIL = "rgb(90, 85, 85)";
const PRINT = "rgb(120, 120, 120)";
export const RED = "rgb(215, 50, 50)";
export const GREEN = "rgb(60, 150, 70)";
export const BLUE = "rgb(40, 110, 190)";

/** Tried in order when GTS_JP_FONT is not set. */
const JAPANESE_FONT_CANDIDATES = [
  "/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf",
  "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
  "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  "/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc",
  "/System/Library/Fonts/Hiragino Sans GB.ttc",
  "C:/Windows/Fonts/meiryo.ttc",
  "C:/Windows/Fonts/msgothic.ttc",
];
const FONT_FAMILY = "GtsSampleJP";
let fontState: "unknown" | "registered" | "missing" = "unknown";

/** Path of a font with Japanese glyphs: $GTS_JP_FONT or a common system font. */
export function findJapaneseFont(): string | null {
  const override = process.env.GTS_JP_FONT;
  if (override) return existsSync(override) ? override : null;
  return JAPANESE_FONT_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export class FontNotFound extends Error {}

function fontFor(text: string, px: number, bold = false): string {
  if (fontState === "unknown") {
    const path = findJapaneseFont();
    fontState = path && GlobalFonts.registerFromPath(path, FONT_FAMILY) ? "registered" : "missing";
  }
  const isAscii = /^[\x00-\x7f]*$/.test(text);
  if (fontState === "missing") {
    if (!isAscii) throw new FontNotFound("no Japanese font found; set GTS_JP_FONT to a .ttf/.ttc/.otf file");
    return `${bold ? "bold " : ""}${px}px sans-serif`;
  }
  return `${bold ? "bold " : ""}${px}px ${FONT_FAMILY}`;
}

/** Text with its baseline at (x, y); `size` is the nominal letter height scale (1 = 34 px). */
export function putText(ctx: SKRSContext2D, text: string, x: number, y: number, size: number, color: string, bold = false): void {
  ctx.font = fontFor(text, Math.round(size * 34), bold);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function textWidth(ctx: SKRSContext2D, text: string, size: number, bold = false): number {
  ctx.font = fontFor(text, Math.round(size * 34), bold);
  return ctx.measureText(text).width;
}

export function line(ctx: SKRSContext2D, x0: number, y0: number, x1: number, y1: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

export interface EngravedMeasure {
  page: number;
  x0: number;
  x1: number;
  staffTop: number;
  tabBottom: number;
}

export interface Engraving {
  pages: SKRSContext2D[];
  truth: EngravedMeasure[];
}

/** Draw every measure of the document on as many pages as needed. */
export function engrave(document: GtsDocument, systemsPerPage?: number): Engraving {
  const measures = document.sections.flatMap((s) => s.measures);
  const labels = new Map(document.sections.map((s) => [s.measures[0]?.id, s.label]));
  const systemHeight = 4 * SPACING + STAFF_TO_TAB + 5 * SPACING;
  const perPage = systemsPerPage ?? Math.floor((HEIGHT - FIRST_SYSTEM_TOP - 200) / (systemHeight + SYSTEM_GAP)) + 1;
  const width = (RIGHT - LEFT) / MEASURES_PER_SYSTEM;

  const pages: SKRSContext2D[] = [];
  const truth: EngravedMeasure[] = [];
  for (let start = 0; start < measures.length; start += MEASURES_PER_SYSTEM) {
    const systemIndex = start / MEASURES_PER_SYSTEM;
    if (systemIndex % perPage === 0) pages.push(blankPage(document.meta, pages.length === 0, pages.length + 1));
    const ctx = pages[pages.length - 1]!;
    const staffTop = FIRST_SYSTEM_TOP + (systemIndex % perPage) * (systemHeight + SYSTEM_GAP);
    const tabTop = staffTop + 4 * SPACING + STAFF_TO_TAB;
    const inSystem = measures.slice(start, start + MEASURES_PER_SYSTEM);
    // A shorter last system ends at its last bar line, as on real paper
    // where the rest of the line is left blank or cut off.
    drawSystemLines(ctx, staffTop, tabTop, Math.trunc(LEFT + inSystem.length * width));
    inSystem.forEach((measure, offset) => {
      const x0 = Math.trunc(LEFT + offset * width);
      const x1 = Math.trunc(LEFT + (offset + 1) * width);
      drawMeasure(ctx, measure, labels.get(measure.id), x0, x1, staffTop, tabTop, offset === 0);
      truth.push({ page: pages.length - 1, x0, x1, staffTop, tabBottom: tabTop + 5 * SPACING });
    });
  }
  return { pages, truth };
}

export function pixels(ctx: SKRSContext2D): RgbaImage {
  const image = ctx.getImageData(0, 0, WIDTH, HEIGHT);
  return { width: WIDTH, height: HEIGHT, data: image.data };
}

function blankPage(meta: GtsDocument["meta"], first: boolean, number: number): SKRSContext2D {
  const ctx = createCanvas(WIDTH, HEIGHT).getContext("2d");
  ctx.fillStyle = PAPER_CSS;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (number > 1) putText(ctx, `No. ${number}`, RIGHT - 120, 150, 0.9, PENCIL);
  if (first) {
    putText(ctx, meta.title, (WIDTH - textWidth(ctx, meta.title, 1.6, true)) / 2, 180, 1.6, PENCIL, true);
    if (meta.artist) putText(ctx, meta.artist, RIGHT - 220, 250, 0.9, PENCIL);
    let info = `Key = ${meta.key ?? "?"}  ${meta.timeSignature ?? ""}  q = ${meta.tempo ?? ""}`;
    if (meta.capo) info += `  Capo ${meta.capo}`;
    putText(ctx, info, LEFT, 250, 0.9, PENCIL);
  }
  return ctx;
}

function drawSystemLines(ctx: SKRSContext2D, staffTop: number, tabTop: number, right: number): void {
  for (let i = 0; i < 5; i++) line(ctx, LEFT, staffTop + i * SPACING, right, staffTop + i * SPACING, PRINT, 2);
  for (let i = 0; i < 6; i++) line(ctx, LEFT, tabTop + i * SPACING, right, tabTop + i * SPACING, PRINT, 2);
  [..."TAB"].forEach((letter, i) => putText(ctx, letter, LEFT + 8, tabTop + 24 + i * 30, 0.9, "rgb(40,40,40)", true));
}

function drawMeasure(
  ctx: SKRSContext2D,
  measure: Measure,
  label: string | undefined,
  x0: number,
  x1: number,
  staffTop: number,
  tabTop: number,
  firstInSystem: boolean,
): void {
  const tabBottom = tabTop + 5 * SPACING;
  for (const x of [x0, x1]) line(ctx, x, staffTop, x, tabBottom, PRINT, 2);
  let contentX0 = x0 + (firstInSystem ? CLEF_WIDTH : 0);
  if (measure.barStart === "repeat-start") {
    const barX = contentX0 + 6;
    thickLine(ctx, barX, staffTop, tabBottom);
    line(ctx, barX + 12, staffTop, barX + 12, tabBottom, PENCIL, 2);
    repeatDots(ctx, barX + 24, tabTop);
    contentX0 = barX + 30;
  }
  let contentX1 = x1;
  if (measure.barEnd === "repeat-end") {
    thickLine(ctx, x1 - 6, staffTop, tabBottom);
    line(ctx, x1 - 18, staffTop, x1 - 18, tabBottom, PENCIL, 2);
    repeatDots(ctx, x1 - 30, tabTop);
    if (measure.repeatTimes) putText(ctx, `x${measure.repeatTimes}`, x1 - 70, staffTop - 20, 1.0, PENCIL);
    contentX1 = x1 - 36;
  } else if (measure.barEnd === "final") {
    line(ctx, x1 - 14, staffTop, x1 - 14, tabBottom, PENCIL, 2);
    thickLine(ctx, x1 - 4, staffTop, tabBottom);
    contentX1 = x1 - 20;
  }

  if (label) {
    const boxWidth = Math.max(50, textWidth(ctx, label, 1.2, true) + 24);
    ctx.strokeStyle = PENCIL;
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 - 10, staffTop - 140, boxWidth, 52);
    putText(ctx, label, x0 - 2, staffTop - 98, 1.2, PENCIL, true);
  }
  if (measure.volta) {
    // Above the chord names, below the section label boxes.
    const y = staffTop - 112;
    line(ctx, x0 + 4, y, x1 - 12, y, PENCIL, 2);
    line(ctx, x0 + 4, y, x0 + 4, y + 30, PENCIL, 2);
    putText(ctx, `${measure.volta.join(",")}.`, x0 + 14, y + 30, 0.9, PENCIL);
  }

  const usable = contentX1 - contentX0 - 30;
  const beatX = (beat: number): number => Math.trunc(contentX0 + 20 + ((beat - 1) / 4) * usable);

  const chords = measure.chords ?? [];
  const chordSize = chords.length <= 2 ? 1.3 : 0.9;
  for (const chord of chords) putText(ctx, chord.symbol, beatX(chord.beat ?? 1), staffTop - 30, chordSize, PENCIL, true);

  // Lyrics go inside the empty standard staff, one line per verse, as on
  // the handwritten scores.
  for (const lyric of measure.lyrics ?? []) {
    const baseline = staffTop + Math.trunc((lyric.verse * 2 - 0.2) * SPACING);
    putText(ctx, lyric.text, contentX0 + 20, baseline, 0.9, lyric.verse > 1 ? GREEN : PENCIL);
  }

  let beat = 1;
  for (const event of measure.beats ?? []) {
    const x = beatX(beat);
    for (const note of event.notes ?? []) {
      const y = tabTop + (note.string - 1) * SPACING;
      const text = note.dead ? "x" : String(note.fret);
      ctx.font = fontFor(text, 27, true);
      const w = ctx.measureText(text).width;
      ctx.fillStyle = PAPER_CSS;
      ctx.fillRect(x - 2, y - 11, w + 4, 22);
      putText(ctx, text, x, y + 9, 0.8, PENCIL, true);
    }
    if (event.rest) {
      // A short rest mark in the middle of the TAB instead of a stem.
      line(ctx, x, tabTop + 2.5 * SPACING, x + 18, tabTop + 2.5 * SPACING, PENCIL, 5);
    } else {
      // Rhythm stems hang below the TAB, as on the handwritten scores.
      const stemX = x + 6;
      line(ctx, stemX, tabBottom + 10, stemX, tabBottom + 55, PENCIL, 2);
      if (event.duration.value >= 8) line(ctx, stemX, tabBottom + 55, stemX + 25, tabBottom + 55, PENCIL, 4);
    }
    if (event.fermata) {
      ctx.strokeStyle = PENCIL;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x + 8, staffTop - 8, 16, 12, 0, Math.PI, 2 * Math.PI);
      ctx.stroke();
      dot(ctx, x + 8, staffTop - 10, 3);
    }
    beat += (4 / event.duration.value) * (event.duration.dots ? 1.5 : 1);
  }
}

function thickLine(ctx: SKRSContext2D, x: number, top: number, bottom: number): void {
  ctx.fillStyle = PENCIL;
  ctx.fillRect(x - 3, top, 7, bottom - top);
}

function dot(ctx: SKRSContext2D, x: number, y: number, r: number): void {
  ctx.fillStyle = PENCIL;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
  ctx.fill();
}

function repeatDots(ctx: SKRSContext2D, x: number, tabTop: number): void {
  for (const i of [2, 3]) dot(ctx, x, tabTop + (i - 0.5) * SPACING, 4);
}

/** Colored pen that layout detection must ignore, crossing a TAB too. */
export function addTeacherNotes(ctx: SKRSContext2D): void {
  putText(ctx, "slow & legato!", 1200, 330, 1.2, RED, true);
  ctx.strokeStyle = RED;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(1300, 800, 140, 60, 0, 0, 2 * Math.PI);
  ctx.stroke();
  const tabTop = FIRST_SYSTEM_TOP + 4 * SPACING + STAFF_TO_TAB;
  line(ctx, 780, tabTop - 20, 790, tabTop + 5 * SPACING + 20, RED, 3);
}

/** Japanese comments in red, green and blue pen, like the real scores. */
export function addJapaneseTeacherNotes(ctx: SKRSContext2D): void {
  const tabTop = FIRST_SYSTEM_TOP + 4 * SPACING + STAFF_TO_TAB;
  putText(ctx, "ゆっくり、しっとり", 1250, 330, 1.1, RED, true);
  putText(ctx, "ここは弦を押さえたまま", 600, tabTop + 5 * SPACING + 95, 0.8, BLUE);
  putText(ctx, "2番は小さく", 1450, FIRST_SYSTEM_TOP + 4 * SPACING + 60, 0.8, GREEN);
  line(ctx, 1080, tabTop - 25, 1090, tabTop + 5 * SPACING + 25, RED, 3);
  const y0 = tabTop + 5 * SPACING + 120;
  const y1 = tabTop + 5 * SPACING + 70;
  line(ctx, 300, y0, 300, y1, BLUE, 3);
  line(ctx, 300, y1, 290, y1 + 14, BLUE, 3);
  line(ctx, 300, y1, 310, y1 + 14, BLUE, 3);
}

/**
 * Debug overlay: detected systems (blue) and the measure regions written to
 * gts (red, numbered within the system), drawn with the Canvas 2D API so the
 * same code serves the Node CLI and the browser.
 */

import { type PageLayout, measureSpans, systemBottom, systemLeft, systemRight, systemTop } from "./detect.ts";
import { systemBands } from "./gts.ts";

export interface Context2D {
  strokeStyle: unknown;
  fillStyle: unknown;
  lineWidth: number;
  font: string;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
}

export const SYSTEM_COLOR = "rgb(0, 0, 255)";
export const MEASURE_COLOR = "rgb(255, 0, 0)";

/** Draw on a context that already shows the upright page (see uprightImage). */
export function drawOverlay(ctx: Context2D, layout: PageLayout): void {
  const thickness = Math.max(Math.trunc(layout.height / 700), 2);
  const bands = systemBands(layout.systems, layout.height);
  ctx.lineWidth = thickness;
  ctx.font = `bold ${thickness * 14}px sans-serif`;
  layout.systems.forEach((system, i) => {
    const [y0, y1] = bands[i]!;
    ctx.strokeStyle = SYSTEM_COLOR;
    const top = systemTop(system);
    ctx.strokeRect(systemLeft(system), top, systemRight(system) - systemLeft(system), systemBottom(system) - top);
    ctx.strokeStyle = MEASURE_COLOR;
    ctx.fillStyle = MEASURE_COLOR;
    measureSpans(system).forEach(([x0, x1], n) => {
      ctx.strokeRect(x0 + thickness, y0, x1 - x0 - 2 * thickness, y1 - y0);
      ctx.fillText(String(n + 1), x0 + 3 * thickness, y0 + 14 * thickness);
    });
  });
}

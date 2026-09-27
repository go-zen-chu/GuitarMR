import { describe, expect, it } from "vitest";
import { analyzePage, measureSpans, systemLeft, systemRight } from "../src/detect.ts";
import type { PageLayout } from "../src/detect.ts";
import { LEFT, RIGHT, drawPage, skew, standardPage, turn } from "./synthetic.ts";

const measureCounts = (layout: PageLayout): number[] => layout.systems.map((s) => measureSpans(s).length);

describe("analyzePage", () => {
  it("If the page is upright it should find every system and measure", () => {
    const layout = analyzePage(standardPage().page);
    expect(layout.rotation).toBe(0);
    expect(measureCounts(layout)).toEqual([4, 4, 4, 4, 4]);
    expect(layout.systems.every((s) => s.staff)).toBe(true);
  });

  it("If the page is TAB only it should find every system and measure", () => {
    const layout = analyzePage(standardPage(false).page);
    expect(layout.rotation).toBe(0);
    expect(measureCounts(layout)).toEqual([4, 4, 4, 4, 4]);
    expect(layout.systems.every((s) => s.staff === null)).toBe(true);
  });

  describe.each([true, false])("with staff: %s", (withStaff) => {
    it.each([
      [90, 270],
      [180, 180],
      [270, 90],
    ])("If the page was scanned turned %i degrees clockwise it should report %i back to upright", (turned, expected) => {
      const layout = analyzePage(turn(standardPage(withStaff).page, turned));
      expect(layout.rotation).toBe(expected);
      expect(measureCounts(layout)).toEqual([4, 4, 4, 4, 4]);
    });

    it("If note stems cross the TAB they should not split measures", () => {
      const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], withStaff, stems: [300, 700, 1300] }]));
      expect(measureCounts(layout)).toEqual([2]);
    });
  });

  it.each([0, 180])("If systems are close together it should still pair each TAB with its own staff (turned %i)", (turned) => {
    const layout = analyzePage(turn(standardPage(true, 7).page, turned));
    expect(layout.rotation).toBe(turned);
    expect(layout.systems).toHaveLength(5);
    expect(layout.systems.every((s) => s.staff)).toBe(true);
    expect(measureCounts(layout)).toEqual([4, 4, 4, 4, 4]);
  });

  it("If the scan is slightly skewed it should still find the measures", () => {
    const layout = analyzePage(skew(standardPage().page, 0.6));
    expect(Math.abs(layout.skew + 0.6)).toBeLessThanOrEqual(0.1);
    expect(measureCounts(layout)).toEqual([4, 4, 4, 4, 4]);
  });

  it("If bar lines are found they should be at the drawn positions", () => {
    const { page, specs } = standardPage();
    const layout = analyzePage(page);
    for (const system of layout.systems) {
      system.barlines.forEach((x, i) => expect(Math.abs(x - specs[0]!.barlines[i]!)).toBeLessThanOrEqual(3));
      expect(Math.abs(systemLeft(system) - LEFT)).toBeLessThanOrEqual(3);
      expect(Math.abs(systemRight(system) - RIGHT)).toBeLessThanOrEqual(3);
    }
  });

  it("If a stem stands right next to a bar line it should keep the bar line", () => {
    const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], stems: [1052] }]));
    expect(measureCounts(layout)).toEqual([2]);
  });

  it("If colored pen crosses the TAB it should be ignored", () => {
    const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], redLines: [500, 1500] }]));
    expect(measureCounts(layout)).toEqual([2]);
  });

  it("If the page has no staff lines it should report no systems", () => {
    expect(analyzePage(drawPage([])).systems).toEqual([]);
  });

  it("If a start repeat follows the clef it should not create a tiny measure", () => {
    const layout = analyzePage(drawPage([{ top: 400, barlines: [LEFT + 45, LEFT + 52, 1060] }]));
    expect(measureCounts(layout)).toEqual([2]);
  });
});

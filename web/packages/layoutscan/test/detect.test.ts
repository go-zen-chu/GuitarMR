import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type PageLayout, analyzePage, measureSpans, systemLeft, systemRight } from "../src/detect.ts";
import { LEFT, RIGHT, drawPage, skew, standardPage, turn } from "./synthetic.ts";

const measureCounts = (layout: PageLayout): number[] => layout.systems.map((s) => measureSpans(s).length);
const near = (actual: number, expected: number, tolerance: number) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

describe("analyzePage", () => {
  it("If the page is upright it should find every system and measure", () => {
    const layout = analyzePage(standardPage().page);
    assert.equal(layout.rotation, 0);
    assert.deepEqual(measureCounts(layout), [4, 4, 4, 4, 4]);
    assert.ok(layout.systems.every((s) => s.staff));
  });

  it("If the page is TAB only it should find every system and measure", () => {
    const layout = analyzePage(standardPage(false).page);
    assert.equal(layout.rotation, 0);
    assert.deepEqual(measureCounts(layout), [4, 4, 4, 4, 4]);
    assert.ok(layout.systems.every((s) => s.staff === null));
  });

  for (const withStaff of [true, false]) {
    describe(`with staff: ${withStaff}`, () => {
      for (const [turned, expected] of [
        [90, 270],
        [180, 180],
        [270, 90],
      ] as const) {
        it(`If the page was scanned turned ${turned} degrees clockwise it should report ${expected} back to upright`, () => {
          const layout = analyzePage(turn(standardPage(withStaff).page, turned));
          assert.equal(layout.rotation, expected);
          assert.deepEqual(measureCounts(layout), [4, 4, 4, 4, 4]);
        });
      }

      it("If note stems cross the TAB they should not split measures", () => {
        const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], withStaff, stems: [300, 700, 1300] }]));
        assert.deepEqual(measureCounts(layout), [2]);
      });
    });
  }

  for (const turned of [0, 180]) {
    it(`If systems are close together it should still pair each TAB with its own staff (turned ${turned})`, () => {
      const layout = analyzePage(turn(standardPage(true, 7).page, turned));
      assert.equal(layout.rotation, turned);
      assert.equal(layout.systems.length, 5);
      assert.ok(layout.systems.every((s) => s.staff));
      assert.deepEqual(measureCounts(layout), [4, 4, 4, 4, 4]);
    });
  }

  it("If the scan is slightly skewed it should still find the measures", () => {
    const layout = analyzePage(skew(standardPage().page, 0.6));
    near(layout.skew, -0.6, 0.1);
    assert.deepEqual(measureCounts(layout), [4, 4, 4, 4, 4]);
  });

  it("If bar lines are found they should be at the drawn positions", () => {
    const { page, specs } = standardPage();
    const layout = analyzePage(page);
    for (const system of layout.systems) {
      system.barlines.forEach((x, i) => near(x, specs[0]!.barlines[i]!, 3));
      near(systemLeft(system), LEFT, 3);
      near(systemRight(system), RIGHT, 3);
    }
  });

  it("If a stem stands right next to a bar line it should keep the bar line", () => {
    const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], stems: [1052] }]));
    assert.deepEqual(measureCounts(layout), [2]);
  });

  it("If colored pen crosses the TAB it should be ignored", () => {
    const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], redLines: [500, 1500] }]));
    assert.deepEqual(measureCounts(layout), [2]);
  });

  it("If the page has no staff lines it should report no systems", () => {
    assert.deepEqual(analyzePage(drawPage([])).systems, []);
  });

  for (const withStaff of [true, false]) {
    it(`If ovals are drawn around stacked chords they should not split measures (with staff: ${withStaff})`, () => {
      const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], withStaff, ovals: [400, 1300, 1700] }]));
      assert.deepEqual(measureCounts(layout), [2]);
    });
  }

  it("If a parenthesis is drawn instead of a bar line it should still split the measures", () => {
    const layout = analyzePage(drawPage([{ top: 400, barlines: [1060], withStaff: false, parens: [600] }]));
    assert.deepEqual(measureCounts(layout), [3]);
  });

  it("If chord names hide part of a staff line it should still pair the staff with its TAB", () => {
    // TAB paper: TAB lines wider apart than staff lines. Writing on the top
    // lines leaves 4 full staff lines in one system and 5 full TAB lines
    // (which look like a staff by count) in another.
    const specs = [0, 1, 2, 3].map((i) => ({
      top: 300 + i * 620,
      barlines: [1060],
      tabSpacing: 22,
      ...(i === 1 ? { staffTopFrom: 1300 } : {}),
      ...(i === 2 ? { tabTopFrom: 1300 } : {}),
    }));
    const layout = analyzePage(drawPage(specs));
    assert.deepEqual(measureCounts(layout), [2, 2, 2, 2]);
    assert.ok(layout.systems.every((s) => s.staff));
  });

  it("If a start repeat follows the clef it should not create a tiny measure", () => {
    const layout = analyzePage(drawPage([{ top: 400, barlines: [LEFT + 45, LEFT + 52, 1060] }]));
    assert.deepEqual(measureCounts(layout), [2]);
  });
});

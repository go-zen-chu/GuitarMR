import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type GtsDocument, type Measure, measures } from "@guitarmr/gts";
import { validate } from "@guitarmr/gts/validate";
import {
  deleteMeasures,
  mergeWithNext,
  nextInSystem,
  removePage,
  restorePage,
  setSectionStart,
  splitMeasure,
} from "../src/index.ts";

/** A layout-only document: `perSystem[page][system]` measures, evenly spaced across each system. */
function layoutDoc(perSystem: number[][]): GtsDocument {
  const all: Measure[] = [];
  perSystem.forEach((systems, page) =>
    systems.forEach((count, s) => {
      for (let i = 0; i < count; i++) {
        const [y0, y1] = [0.1 + 0.2 * s, 0.3 + 0.2 * s];
        all.push({ id: `m${all.length + 1}`, region: { page, bbox: [0.05 + (0.9 * i) / count, y0, 0.05 + (0.9 * (i + 1)) / count, y1] } });
      }
    }),
  );
  return {
    format: "gts",
    version: "0.1",
    meta: { title: "t", layers: ["layout"] },
    source: {
      file: "t.pdf",
      sha256: "0".repeat(64),
      pages: perSystem.map((_, index) => ({ index, rotation: 0 })) as GtsDocument["source"]["pages"],
    },
    sections: [{ measures: all }],
  };
}

/** The document with chords and a review on every measure, as after reading. */
function read(doc: GtsDocument): GtsDocument {
  const out = structuredClone(doc);
  for (const m of measures(out)) {
    m.chords = [{ beat: 1, symbol: "Am" }];
    m.review = { status: "auto" };
  }
  return out;
}

const ids = (doc: GtsDocument) => measures(doc).map((m) => m.id);
const bboxOf = (doc: GtsDocument, id: string) =>
  measures(doc).find((m) => m.id === id)!.region!.bbox.map((v) => Math.round(v * 10000) / 10000);
const assertValid = (doc: GtsDocument) => assert.deepEqual(validate(doc).errors ?? [], []);

describe("deleteMeasures", () => {
  it("If a measure is deleted it should be gone and the others numbered in order again", () => {
    const doc = deleteMeasures(layoutDoc([[4]]), ["m2"]);
    assert.deepEqual(ids(doc), ["m1", "m2", "m3"]);
    assert.deepEqual(bboxOf(doc, "m2"), bboxOf(layoutDoc([[4]]), "m3"));
    assertValid(doc);
  });

  it("If every measure of a section is deleted it should drop the section and keep the others", () => {
    const doc = setSectionStart(layoutDoc([[4]]), "m3", "B");
    const out = deleteMeasures(doc, ["m1", "m2"]);
    assert.equal(out.sections.length, 1);
    assert.equal(out.sections[0]!.label, "B");
    assert.deepEqual(ids(out), ["m1", "m2"]);
  });

  it("If every measure would be deleted it should refuse", () => {
    assert.throws(() => deleteMeasures(layoutDoc([[2]]), ["m1", "m2"]));
  });
});

describe("splitMeasure", () => {
  it("If a measure is split it should become two measures meeting at the given x", () => {
    const doc = splitMeasure(layoutDoc([[2]]), "m1", 0.3);
    assert.deepEqual(ids(doc), ["m1", "m2", "m3"]);
    assert.deepEqual(bboxOf(doc, "m1"), [0.05, 0.1, 0.3, 0.3]);
    assert.deepEqual(bboxOf(doc, "m2"), [0.3, 0.1, 0.5, 0.3]);
    assertValid(doc);
  });

  it("If a read measure is split it should keep its start on the left, its end on the right and drop what was read", () => {
    const doc = read(layoutDoc([[2]]));
    Object.assign(measures(doc)[0]!, { barStart: "repeat-start", barEnd: "repeat-end", repeatTimes: 3 });
    const [left, right] = measures(splitMeasure(doc, "m1", 0.3));
    assert.equal(left!.barStart, "repeat-start");
    assert.equal(left!.barEnd, undefined);
    assert.equal(right!.barEnd, "repeat-end");
    assert.equal(right!.repeatTimes, 3);
    for (const m of [left!, right!]) {
      assert.equal(m.chords, undefined);
      assert.equal(m.review, undefined);
    }
  });

  it("If the split point is at the edge of the measure it should refuse", () => {
    assert.throws(() => splitMeasure(layoutDoc([[2]]), "m1", 0.06));
    assert.throws(() => splitMeasure(layoutDoc([[2]]), "m1", 0.7));
  });
});

describe("mergeWithNext", () => {
  it("If two measures of a system are merged they should become one spanning both", () => {
    const doc = mergeWithNext(read(layoutDoc([[4]])), "m2");
    assert.deepEqual(ids(doc), ["m1", "m2", "m3"]);
    assert.deepEqual(bboxOf(doc, "m2"), [0.275, 0.1, 0.725, 0.3]);
    assert.equal(measures(doc)[1]!.chords, undefined);
    assert.equal(measures(doc)[0]!.chords?.length, 1);
    assertValid(doc);
  });

  it("If the measure ends its system it should have no next measure to merge with", () => {
    const doc = layoutDoc([[2, 2], [2]]);
    assert.equal(nextInSystem(doc, "m2"), undefined);
    assert.equal(nextInSystem(doc, "m4"), undefined);
    assert.equal(nextInSystem(doc, "m1")?.id, "m2");
    assert.throws(() => mergeWithNext(doc, "m2"));
  });
});

describe("removePage and restorePage", () => {
  it("If a page is removed its measures and source entry should go", () => {
    const doc = removePage(layoutDoc([[2], [3], [2]]), 1);
    assert.deepEqual(ids(doc), ["m1", "m2", "m3", "m4"]);
    assert.ok(measures(doc).every((m) => m.region!.page !== 1));
    assert.deepEqual(doc.source.pages.map((p) => p.index), [0, 2]);
    assertValid(doc);
  });

  it("If a removed page is restored its detected measures should come back in page order", () => {
    const detected = layoutDoc([[2], [3], [2]]);
    const doc = restorePage(removePage(read(detected), 1), detected, 1);
    assert.deepEqual(measures(doc).map((m) => m.region!.page), [0, 0, 1, 1, 1, 2, 2]);
    assert.deepEqual(ids(doc), ids(detected));
    assert.equal(measures(doc)[0]!.chords?.length, 1);
    assert.equal(measures(doc)[2]!.chords, undefined);
    assert.deepEqual(doc.source.pages.map((p) => p.index), [0, 1, 2]);
    assertValid(doc);
  });

  it("If the last page is restored it should go to the end", () => {
    const detected = layoutDoc([[2], [2]]);
    const doc = restorePage(removePage(detected, 1), detected, 1);
    assert.deepEqual(measures(doc).map((m) => m.region!.page), [0, 0, 1, 1]);
  });
});

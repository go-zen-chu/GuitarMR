import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type GtsDocument, type Measure, measures } from "@guitarmr/gts";
import { validate } from "@guitarmr/gts/validate";
import {
  STRUCTURE_FIELDS,
  applyReading,
  cropsByPage,
  pagePrompt,
  parseReading,
  reviewSummary,
  setSectionStart,
  systemCrops,
  updateMeasure,
} from "../src/index.ts";

const EXAMPLES = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(`${name}.gts.json`, EXAMPLES), "utf8"));

/** What layoutscan alone produces: regions only, one unlabeled section. */
function layoutOnly(truth: GtsDocument): GtsDocument {
  return {
    ...truth,
    meta: { title: truth.source.file.replace(/\.pdf$/, ""), layers: ["layout"] },
    sections: [{ measures: measures(truth).map((m) => ({ id: m.id!, region: m.region! })) }],
  };
}

/** A perfect answer for one page, in the shape the prompt asks for. */
function perfectAnswer(truth: GtsDocument, ids: string[], header: boolean): unknown {
  const labels = new Map(truth.sections.map((s) => [s.measures[0]!.id, s.label]));
  const answer: Record<string, unknown> = {
    measures: measures(truth)
      .filter((m) => ids.includes(m.id!))
      .map((m) => ({
        id: m.id,
        ...Object.fromEntries(STRUCTURE_FIELDS.filter((f) => m[f] !== undefined).map((f) => [f, m[f]])),
        ...(labels.get(m.id) ? { section: labels.get(m.id) } : {}),
        chords: m.chords ?? [],
        confidence: 0.95,
      })),
  };
  if (header) {
    const { title, key, capo, tempo, timeSignature } = truth.meta;
    answer.header = { title, key, capo, tempo, timeSignature };
  }
  return answer;
}

const structureOf = (m: Measure) =>
  Object.fromEntries(STRUCTURE_FIELDS.filter((f) => m[f] !== undefined && !(f === "chords" && !m.chords?.length)).map((f) => [f, m[f]]));

for (const name of ["twinkle-twinkle", "sakura-sakura"]) {
  describe(`reading ${name}`, () => {
    const truth = load(name);

    it("If crops are made each system should list its measures left to right", () => {
      const crops = systemCrops(layoutOnly(truth));
      assert.deepEqual(
        crops.flatMap((c) => c.measures.map((m) => m.id)),
        measures(truth).map((m) => m.id),
      );
      for (const c of crops) {
        assert.ok(c.bbox[0] < c.bbox[2] && c.bbox[1] < c.bbox[3]);
        c.measures.forEach((m, i) => {
          assert.ok(m.x0 >= 0 && m.x0 < m.x1 && m.x1 <= 1, m.id);
          if (i) assert.ok(m.x0 >= c.measures[i - 1]!.x1 - 1e-9, m.id);
        });
      }
      // Engraved samples have 4 measures per full system.
      assert.ok(crops.every((c) => c.measures.length <= 4));
    });

    it("If every page is answered perfectly the document should match the sample", () => {
      let doc = layoutOnly(truth);
      let first = true;
      for (const [, crops] of cropsByPage(doc)) {
        const ids = crops.flatMap((c) => c.measures.map((m) => m.id));
        const prompt = pagePrompt(crops, { header: first });
        for (const id of ids) assert.ok(prompt.includes(id));
        const reading = parseReading(JSON.parse(JSON.stringify(perfectAnswer(truth, ids, first))), ids);
        assert.deepEqual(reading.warnings, []);
        doc = applyReading(doc, reading);
        first = false;
      }
      assert.deepEqual(validate(doc), { valid: true, errors: [] });
      assert.deepEqual(doc.meta.layers, ["layout", "structure", "chords"]);
      assert.deepEqual(
        doc.sections.map((s) => [s.label, s.measures.length]),
        truth.sections.map((s) => [s.label, s.measures.length]),
      );
      assert.deepEqual(measures(doc).map(structureOf), measures(truth).map(structureOf));
      for (const key of ["title", "key", "capo", "tempo", "timeSignature"] as const) {
        assert.equal(doc.meta[key], truth.meta[key], key);
      }
      assert.deepEqual(reviewSummary(doc), { total: measures(doc).length, unread: 0, auto: measures(doc).length, attention: 0, reviewed: 0 });
    });
  });
}

describe("checking answers", () => {
  const ids = ["m1", "m2", "m3", "m4"];

  it("If an answer has invalid parts they should be dropped and reported", () => {
    const reading = parseReading(
      {
        measures: [
          { id: "m1", chords: [{ symbol: "E7", beat: 3 }, { symbol: "Am", beat: 1 }, { symbol: "H7", beat: 1 }, "G"], barEnd: "thick" },
          { id: "m2", chords: [{ symbol: "C" }], simile: 1, repeatTimes: 3 },
          { id: "m3", chords: [], navigation: ["ds", "jump"], volta: [1, "2"], confidence: 0.4, note: "かすれている" },
          { id: "m99", chords: [] },
        ],
      },
      ids,
    );
    const [m1, m2, m3] = reading.measures;
    assert.deepEqual(m1!.chords, [
      { symbol: "Am", beat: 1 },
      { symbol: "E7", beat: 3 },
      { symbol: "G", beat: 1 },
    ].sort((a, b) => a.beat - b.beat));
    assert.equal(m1!.barEnd, undefined);
    // A simile measure keeps the chord written over it (same pattern, new chord).
    assert.deepEqual([m2!.simile, m2!.chords, m2!.repeatTimes], [1, [{ symbol: "C", beat: 1 }], undefined]);
    assert.deepEqual([m3!.navigation, m3!.volta], [["ds"], [1]]);
    assert.equal(reading.measures.length, 3);
    assert.ok(reading.warnings.some((w) => w.startsWith("m4: no answer")));
    assert.ok(reading.warnings.some((w) => w.includes("H7")));
  });

  it("If Claude is unsure the measure should be marked for review with its note", () => {
    const truth = load("twinkle-twinkle");
    const doc = applyReading(layoutOnly(truth), parseReading({ measures: [{ id: "m1", chords: [], confidence: 0.4, note: "?" }] }, ["m1"]));
    assert.deepEqual(measures(doc)[0]!.review, { status: "needs-attention", confidence: 0.4, comment: "?" });
    // Not every measure is read yet, so the layers are not claimed.
    assert.deepEqual(doc.meta.layers, ["layout"]);
    assert.equal(reviewSummary(doc).unread, measures(doc).length - 1);
  });
});

describe("editing", () => {
  const doc = load("twinkle-twinkle");

  it("If a section start is moved or removed the sections should regroup", () => {
    const moved = setSectionStart(setSectionStart(doc, "m5", undefined), "m7", "B");
    assert.deepEqual(
      moved.sections.map((s) => [s.label, s.measures[0]!.id, s.measures.length]),
      [
        ["A", "m1", 6],
        ["B", "m7", 2],
        ["A'", "m9", 4],
      ],
    );
    assert.equal(validate(moved).valid, true);
    assert.equal(measures(moved).length, measures(doc).length);
  });

  it("If a measure is updated empty fields should be removed and simile should drop its own beats", () => {
    const edited = updateMeasure(doc, "m2", { barStart: undefined, navigation: [], simile: 1, review: { status: "reviewed" } });
    const m2 = measures(edited)[1]!;
    assert.equal("beats" in m2, false);
    assert.deepEqual(m2.chords, measures(doc)[1]!.chords);
    assert.equal(m2.simile, 1);
    assert.equal("navigation" in m2, false);
    assert.equal(validate(edited).valid, true);
    assert.equal(measures(doc)[1]!.simile, undefined); // the input is not changed
  });
});

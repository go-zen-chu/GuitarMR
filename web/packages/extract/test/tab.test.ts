import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { type GtsDocument, formatTabLine, measures } from "@guitarmr/gts";
import { validate } from "@guitarmr/gts/validate";
import { applyTabReading, parseTabReading, systemCrops, tabPrompt, tabUnread } from "../src/index.ts";

const load = (name: string): GtsDocument =>
  JSON.parse(readFileSync(new URL(`../../../../schemas/examples/${name}.gts.json`, import.meta.url), "utf8"));

/** The sample as read up to chords: every beat removed, reviews "auto". */
function withoutTab(truth: GtsDocument): GtsDocument {
  const doc = structuredClone(truth);
  for (const m of measures(doc)) {
    delete m.beats;
    m.review = { status: "auto", confidence: 0.9 };
  }
  doc.meta.layers = doc.meta.layers?.filter((l) => l !== "tab");
  return doc;
}

const answer = (doc: GtsDocument, tabs: Record<string, string>) => ({
  measures: measures(doc).map((m) => ({ id: m.id, tab: tabs[m.id!] ?? formatTabLine(m.beats), confidence: 0.9 })),
});

describe("reading the tab layer", () => {
  for (const name of ["sample", "sakura-sakura", "twinkle-twinkle"]) {
    it(`If ${name} is read perfectly its beats should match and the tab layer be listed`, () => {
      const truth = load(name);
      let doc = withoutTab(truth);
      assert.ok(tabUnread(doc).length > 0);
      for (const crop of systemCrops(doc)) {
        const ids = crop.measures.map((m) => m.id);
        const reading = parseTabReading(answer(truth, {}), ids);
        assert.deepEqual(reading.warnings, []);
        doc = applyTabReading(doc, reading);
      }
      // Measures with chords only come back as read with nothing on the TAB.
      assert.deepEqual(
        measures(doc).map((m) => m.beats),
        measures(truth).map((m) => (m.simile ? undefined : (m.beats ?? []))),
      );
      assert.deepEqual(tabUnread(doc), []);
      assert.ok(doc.meta.layers?.includes("tab"));
      assert.ok(measures(doc).every((m) => m.review?.status === "auto"), JSON.stringify(measures(doc).map((m) => m.review)));
      assert.deepEqual(validate(doc), { valid: true, errors: [] });
    });
  }

  it("If a read measure fails a check or cannot be read it should be marked for review with why", () => {
    const truth = load("twinkle-twinkle");
    const ids = measures(truth).map((m) => m.id!);
    const reading = parseTabReading(
      {
        measures: [
          { id: "m1", tab: "4:3-0 4:3-0 4:2-3", confidence: 0.9 }, // pickup-free first measure may be short
          { id: "m2", tab: "4:2-1 4:2-1 4:2-0", confidence: 0.9 }, // one beat short
          { id: "m3", tab: "4:2-1 4:9-1+2-1 2:2-0", confidence: 0.9 }, // two notes on string 2
          { id: "m4", tab: "4:3-2 4:3-2 2:3-30", confidence: 0.9 }, // fret 30 is not a fret
          { id: "m5", tab: "", confidence: 0.3, note: "かすれて読めない" },
          { id: "m6", tab: "4:3-0 4:3-0 4:2-3 4:2-3", confidence: 0.5 },
          { id: "m7", tab: "4:3-0 4:3-0 4:2-3 4:2-3", confidence: 0.95 },
        ],
      },
      ids.slice(0, 8),
    );
    assert.deepEqual(reading.warnings.filter((w) => /^m8/.test(w)), ["m8: no answer"]);
    assert.ok(reading.warnings.some((w) => w.startsWith("m3: 「9-1」")));
    const doc = applyTabReading(withoutTab(truth), reading);
    const byId = new Map(measures(doc).map((m) => [m.id, m]));
    const comment = (id: string) => byId.get(id)!.review!.comment ?? "";
    assert.equal(byId.get("m1")!.review!.status, "auto");
    assert.match(comment("m2"), /拍が足りません（4\/4 に 3 拍）/);
    assert.match(comment("m3"), /読めない部分があります/);
    assert.match(comment("m4"), /0〜24/);
    assert.equal(comment("m5"), "かすれて読めない");
    assert.deepEqual(byId.get("m5")!.beats, []);
    assert.equal(byId.get("m6")!.review!.status, "needs-attention");
    assert.equal(byId.get("m7")!.review!.status, "auto");
    assert.ok(!doc.meta.layers?.includes("tab"));
  });

  it("If a measure is a repeat sign it should keep no beats and be skipped in the prompt", () => {
    const doc = withoutTab(load("twinkle-twinkle"));
    measures(doc)[1]!.simile = 1;
    const crop = systemCrops(doc)[0]!;
    const prompt = tabPrompt([crop], new Set(["m2"]));
    assert.match(prompt, /measures m1, m2 \(repeat sign, skip\), m3/);
    const out = applyTabReading(doc, parseTabReading({ measures: [{ id: "m2", tab: "4:1-0 4:1-0 4:1-0 4:1-0" }] }, ["m2"]));
    assert.equal(measures(out)[1]!.beats, undefined);
    assert.ok(!tabUnread(out).includes("m2"));
  });

  it("If a measure marked for review gets its tab read it should stay marked, its remark not repeated", () => {
    const doc = withoutTab(load("twinkle-twinkle"));
    measures(doc)[1]!.review = { status: "needs-attention", comment: "コードがかすれている" };
    const read = (d: GtsDocument) => applyTabReading(d, parseTabReading({ measures: [{ id: "m2", tab: "4:2-1", confidence: 0.9 }] }, ["m2"]));
    const twice = read(read(doc));
    assert.deepEqual(measures(twice)[1]!.review, {
      status: "needs-attention",
      confidence: 0.9,
      comment: "コードがかすれている。拍が足りません（4/4 に 1 拍）",
    });
  });
});

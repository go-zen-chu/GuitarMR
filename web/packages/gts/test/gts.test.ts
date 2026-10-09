import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { type GtsDocument, formatChordLine, measureLength, measures, parseChordLine } from "../src/index.ts";
import { validate } from "../src/validate.ts";

const examples = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(name, examples), "utf8"));
const names = readdirSync(examples).filter((f) => f.endsWith(".gts.json"));

describe("gts examples", () => {
  for (const name of names) {
    it(`If ${name} is validated it should match the schema`, () => {
      assert.deepEqual(validate(load(name)), { valid: true, errors: [] });
    });

    it(`If ${name} tab is read every measure should fill 4/4`, () => {
      for (const m of measures(load(name)).filter((m) => m.beats)) assert.deepEqual(measureLength(m), [1, 1], m.id ?? "");
    });
  }
});

describe("validate", () => {
  it("If a string number is out of range it should report the path", () => {
    const doc = load("twinkle-twinkle.gts.json");
    (doc.sections[0].measures[0]!.beats![0]!.notes![0]! as { string: number }).string = 7;
    const result = validate(doc);
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /\/sections\/0\/measures\/0\/beats\/0\/notes\/0\/string/);
  });
});

describe("measureLength", () => {
  it("If beats use dots and triplets it should add them exactly", () => {
    const m = {
      beats: [
        { duration: { value: 8, dots: 1 }, rest: true },
        { duration: { value: 16 }, rest: true },
        { duration: { value: 8, tuplet: [3, 2] }, rest: true },
        { duration: { value: 8, tuplet: [3, 2] }, rest: true },
        { duration: { value: 8, tuplet: [3, 2] }, rest: true },
        { duration: { value: 2 }, rest: true },
      ],
    } as GtsDocument["sections"][0]["measures"][0];
    assert.deepEqual(measureLength(m), [1, 1]);
  });
});

describe("chord lines", () => {
  it("If chords sit at even positions the line should omit the beats", () => {
    assert.equal(formatChordLine([{ symbol: "Am", beat: 1 }, { symbol: "E7", beat: 3 }]), "Am E7");
    assert.equal(formatChordLine([{ symbol: "C", beat: 1 }, { symbol: "G/B", beat: 2.5 }]), "C G/B@2.5");
    assert.equal(formatChordLine([{ symbol: "C" }], 3), "C");
  });

  it("If a line is parsed it should round-trip and use even defaults", () => {
    assert.deepEqual(parseChordLine("Am　E7@4").chords, [
      { symbol: "Am", beat: 1 },
      { symbol: "E7", beat: 4 },
    ]);
    assert.deepEqual(
      parseChordLine("C F G7", 3).chords.map((c) => c.beat),
      [1, 2, 3],
    );
    const line = "Dm7-5 G7@2.5 N.C.@4";
    assert.equal(formatChordLine(parseChordLine(line).chords), line);
  });

  it("If a token is not a chord it should be reported and dropped", () => {
    const { chords, invalid } = parseChordLine("Am H7 C@9");
    assert.deepEqual(chords, [{ symbol: "Am", beat: 1 }]);
    assert.deepEqual(invalid, ["H7", "C@9"]);
  });
});

describe("beat feel", () => {
  it("If a score names its feel it should accept 4, 8 or 16 only", () => {
    const doc = load("twinkle-twinkle.gts.json");
    for (const beat of [4, 8, 16]) assert.equal(validate({ ...doc, meta: { ...doc.meta, beat } }).valid, true);
    assert.equal(validate({ ...doc, meta: { ...doc.meta, beat: 12 } }).valid, false);
  });
});

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { type GtsDocument, measureLength, measures } from "../src/index.ts";
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
      for (const m of measures(load(name)).filter((m) => m.beats)) assert.deepEqual(measureLength(m), [1, 1], m.id);
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

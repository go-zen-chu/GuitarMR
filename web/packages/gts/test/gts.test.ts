import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type GtsDocument, measureLength, measures, validate } from "../src/index.ts";

const examples = new URL("../../../../schemas/examples/", import.meta.url);
const load = (name: string): GtsDocument => JSON.parse(readFileSync(new URL(name, examples), "utf8"));
const names = readdirSync(examples).filter((f) => f.endsWith(".gts.json"));

describe("gts examples", () => {
  it.each(names)("If %s is validated it should match the schema", (name) => {
    expect(validate(load(name))).toEqual({ valid: true, errors: [] });
  });

  it.each(names)("If %s tab is read every measure should fill 4/4", (name) => {
    const doc = load(name);
    for (const m of measures(doc).filter((m) => m.beats)) expect(measureLength(m), m.id).toEqual([1, 1]);
  });
});

describe("validate", () => {
  it("If a string number is out of range it should report the path", () => {
    const doc = load("twinkle-twinkle.gts.json");
    (doc.sections[0].measures[0]!.beats![0]!.notes![0]! as { string: number }).string = 7;
    const result = validate(doc);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("/sections/0/measures/0/beats/0/notes/0/string");
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
    expect(measureLength(m)).toEqual([1, 1]);
  });
});

/**
 * gts (Guitar Tab Score) documents: generated types, schema validation and
 * small helpers shared by the tools and the PWA.
 */

import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../../../schemas/gts.schema.json" with { type: "json" };
import type { Beat, GuitarTabScoreGts, Measure } from "./types.generated.ts";

export type * from "./types.generated.ts";
export type GtsDocument = GuitarTabScoreGts;
export { schema };

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validator = ajv.compile<GtsDocument>(schema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a parsed JSON value against schemas/gts.schema.json. */
export function validate(document: unknown): ValidationResult {
  const valid = validator(document);
  const errors = (validator.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  return { valid, errors: valid ? [] : errors };
}

/** Every measure in written order. */
export function measures(document: GtsDocument): Measure[] {
  return document.sections.flatMap((s) => s.measures);
}

/** Length of a beat as a fraction of a whole note, [numerator, denominator]. */
export function beatLength(beat: Beat): [number, number] {
  const d = beat.duration;
  let num = 1;
  let den = d.value;
  // Each dot adds half of the previous value: 1 + 1/2 + 1/4 ...
  for (let i = 0; i < (d.dots ?? 0); i++) {
    num = num * 2 + 1;
    den *= 2;
  }
  if (d.tuplet) {
    num *= d.tuplet[1];
    den *= d.tuplet[0];
  }
  return reduce(num, den);
}

/** Sum of beat lengths of a measure as a reduced fraction. */
export function measureLength(measure: Measure): [number, number] {
  return (measure.beats ?? []).map(beatLength).reduce<[number, number]>(
    ([an, ad], [bn, bd]) => reduce(an * bd + bn * ad, ad * bd),
    [0, 1],
  );
}

function reduce(num: number, den: number): [number, number] {
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(num, den) || 1;
  return [num / g, den / g];
}

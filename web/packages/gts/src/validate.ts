/**
 * Validation against schemas/gts.schema.json, for tests and Node tooling.
 * Kept out of the main entry so ajv never ships to the PWA.
 */

import { Ajv2020 } from "ajv/dist/2020.js";
import schema from "../../../../schemas/gts.schema.json" with { type: "json" };
import type { GtsDocument } from "./index.ts";

const validator = new Ajv2020({ allErrors: true, strict: false }).compile<GtsDocument>(schema);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validate(document: unknown): ValidationResult {
  const valid = validator(document);
  const errors = (validator.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message ?? ""}`.trim());
  return { valid, errors: valid ? [] : errors };
}

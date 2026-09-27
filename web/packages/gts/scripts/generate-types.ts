// Regenerates src/types.generated.ts from schemas/gts.schema.json.
import { writeFileSync, readFileSync } from "node:fs";
import { compile } from "json-schema-to-typescript";

const schemaPath = new URL("../../../../schemas/gts.schema.json", import.meta.url);
const outPath = new URL("../src/types.generated.ts", import.meta.url);

const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const ts = await compile(schema, "GtsDocument", {
  bannerComment:
    "/* Generated from schemas/gts.schema.json by `pnpm --filter @guitarmr/gts generate`. Do not edit. */",
  additionalProperties: false,
  style: { singleQuote: false, printWidth: 110 },
});
writeFileSync(outPath, ts);
console.log(`wrote ${outPath.pathname}`);

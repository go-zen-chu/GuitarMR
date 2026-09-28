import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { validate } from "@guitarmr/gts/validate";
import { analyzePage } from "../src/detect.ts";
import { type ScannedPage, buildDocument } from "../src/gts.ts";
import { standardPage } from "./synthetic.ts";

describe("buildDocument", () => {
  let pages: ScannedPage[];
  before(() => {
    const layout = analyzePage(standardPage().page);
    pages = [
      { index: 0, layout },
      { index: 2, layout },
    ];
  });

  it("If a document is built it should validate against the gts schema", () => {
    const doc = buildDocument("song.pdf", "0".repeat(64), pages);
    assert.deepEqual(validate(doc), { valid: true, errors: [] });
    assert.deepEqual(doc.meta, { title: "song", layers: ["layout"] });
    assert.deepEqual(doc.source.pages, [
      { index: 0, rotation: 0 },
      { index: 2, rotation: 0 },
    ]);
  });

  it("If measures are built they should be numbered in written order", () => {
    const measures = buildDocument("song.pdf", "0".repeat(64), pages).sections[0].measures;
    assert.deepEqual(
      measures.map((m) => m.id),
      Array.from({ length: 40 }, (_, i) => `m${i + 1}`),
    );
    assert.deepEqual(
      measures.map((m) => m.region!.page),
      [...Array(20).fill(0), ...Array(20).fill(2)],
    );
  });

  it("If regions are built they should tile each system without overlap", () => {
    const boxes = buildDocument("song.pdf", "0".repeat(64), pages)
      .sections[0].measures.slice(0, 20)
      .map((m) => m.region!.bbox);
    const rows = Array.from({ length: 5 }, (_, i) => boxes.slice(i * 4, i * 4 + 4));
    for (const row of rows) row.slice(1).forEach((box, i) => assert.equal(box[0], row[i]![2])); // shared bar line
    rows.slice(1).forEach((row, i) => assert.ok(rows[i]![0]![3] <= row[0]![1])); // bands do not overlap
  });
});

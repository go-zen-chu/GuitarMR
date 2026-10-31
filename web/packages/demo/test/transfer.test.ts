import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type { GtsDocument } from "@guitarmr/gts";
import type { LibraryEntry } from "../src/library.ts";
import { CHUNK_BYTES, exportLibrary, importLibrary, isLibraryExport, linesOf, mergeEntry } from "../src/transfer.ts";

const doc = (name: string): GtsDocument =>
  JSON.parse(readFileSync(new URL(`../../../../schemas/examples/${name}.gts.json`, import.meta.url), "utf8"));

/** Deterministic bytes standing in for a PDF or photo. */
function bytes(length: number, seed: number): ArrayBuffer {
  const out = new Uint8Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out.buffer;
}

function library(): LibraryEntry[] {
  return [
    {
      id: "a".repeat(64),
      name: "song.pdf",
      kind: "pdf",
      files: [{ name: "song.pdf", type: "application/pdf", data: bytes(2.5 * CHUNK_BYTES, 1) }],
      doc: doc("twinkle-twinkle"),
      added: 1,
      updated: 30,
    },
    {
      id: "b".repeat(64),
      name: "IMG_0001.jpg",
      kind: "photos",
      files: [
        { name: "IMG_0001.jpg", type: "image/jpeg", data: bytes(200_000, 2) },
        { name: "IMG_0002.jpg", type: "image/jpeg", data: bytes(150_000, 3) },
      ],
      doc: doc("sakura-sakura"),
      added: 2,
      updated: 20,
    },
    { id: "c".repeat(64), name: "sample.pdf", kind: "sample", files: [], doc: null, added: 3, updated: 10 },
  ];
}

const parse = (lines: string[]) => lines.map((l) => JSON.parse(l) as { type?: string; entry?: unknown; data?: string });

describe("library transfer", () => {
  it("If the library is exported and imported it should come back whole", async () => {
    const lines = await exportLibrary(library(), { files: true });
    assert.ok(isLibraryExport(lines[0]!));
    const result = await importLibrary(lines);
    assert.deepEqual(result.withoutFiles, []);
    assert.equal(result.truncated, false);
    assert.equal(result.skipped, 0);
    const byId = new Map(result.entries.map((e) => [e.id, e]));
    for (const e of library()) assert.deepEqual(byId.get(e.id), e);
  });

  it("If the library is exported the scores should come before any file data, small files first", async () => {
    const records = parse(await exportLibrary(library(), { files: true }));
    const types = records.map((r) => r.type ?? "header");
    const firstChunk = types.indexOf("chunk");
    assert.deepEqual(types.slice(0, firstChunk), ["header", "entry", "entry", "entry"]);
    assert.deepEqual(new Set(types.slice(firstChunk, -1)), new Set(["chunk"]));
    assert.equal(types.at(-1), "end");
    const sizes = records
      .filter((r) => r.type === "chunk")
      .map((r) => (r as unknown as { entry: string; file: number }))
      .map((r) => `${r.entry[0]}${r.file}`);
    // The 150 KB and 200 KB photos come before the PDF.
    assert.deepEqual([...new Set(sizes)], ["b1", "b0", "a0"]);
  });

  it("If the file is cut short every score's work should still come through", async () => {
    const lines = await exportLibrary(library(), { files: true });
    const result = await importLibrary(lines.slice(0, lines.length - 3));
    assert.equal(result.truncated, true);
    assert.equal(result.entries.length, 3);
    assert.deepEqual(result.withoutFiles, ["song.pdf"]);
    const pdf = result.entries.find((e) => e.name === "song.pdf")!;
    assert.deepEqual(pdf.files, []);
    assert.deepEqual(pdf.doc, doc("twinkle-twinkle"));
    assert.equal(result.entries.find((e) => e.kind === "photos")!.files.length, 2);
  });

  it("If file data is damaged the score should come through without its files and the others untouched", async () => {
    const lines = await exportLibrary(library(), { files: true });
    const records = parse(lines);
    const i = records.findIndex((r) => r.type === "chunk" && (r as { entry?: string }).entry === "b".repeat(64));
    const damaged = { ...records[i]!, data: `AAAA${records[i]!.data!.slice(4)}` };
    lines[i] = JSON.stringify(damaged);
    lines[i + 1] = lines[i + 1]!.slice(0, 50); // and a broken line
    const result = await importLibrary(lines);
    assert.deepEqual(result.withoutFiles, ["IMG_0001.jpg"]);
    assert.equal(result.skipped, 1);
    assert.deepEqual(result.entries.find((e) => e.kind === "photos")!.doc, doc("sakura-sakura"));
    assert.equal(result.entries.find((e) => e.name === "song.pdf")!.files.length, 1);
  });

  it("If only the work is exported there should be no file data and nothing reported missing", async () => {
    const lines = await exportLibrary(library(), { files: false });
    assert.ok(parse(lines).every((r) => r.type !== "chunk"));
    const result = await importLibrary(lines);
    assert.deepEqual(result.withoutFiles, []);
    assert.ok(result.entries.every((e) => e.files.length === 0 && (e.kind === "sample" || e.doc)));
  });

  it("If another file is imported it should be refused", async () => {
    await assert.rejects(importLibrary(['{"format":"gts","version":"0.1"}']), /書き出しファイルではありません/);
    await assert.rejects(importLibrary(["%PDF-1.4"]), /書き出しファイルではありません/);
  });

  it("If an imported score is already on the device the newer work should win and the device's files stay", () => {
    const [local] = library();
    const incoming = { ...local!, files: [], doc: doc("sample"), updated: 99, added: 0 };
    const merged = mergeEntry(local, incoming);
    assert.equal(merged.doc, incoming.doc);
    assert.equal(merged.files, local!.files);
    assert.deepEqual([merged.added, merged.updated], [0, 99]);
    assert.equal(mergeEntry(local, { ...incoming, updated: 5 }).doc, local!.doc);
  });

  it("If an export is read as a file it should yield the same lines", async () => {
    const lines = await exportLibrary(library(), { files: true });
    const read: string[] = [];
    for await (const line of linesOf(new Blob([lines.join("\n")]))) read.push(line);
    assert.deepEqual(read, lines);
  });
});

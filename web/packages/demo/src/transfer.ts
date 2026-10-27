/**
 * Moving the library to another device: one text file, one JSON record per
 * line, written light to heavy. First come every score and the work on it
 * (the gts documents, small), then the files (PDFs and photos, large), cut
 * into chunks of a few hundred KB, each file carrying its SHA-256.
 *
 * So whatever happens to the file on the way (cut short, a damaged line),
 * the work on every score survives: a broken or missing line is skipped,
 * and a score whose files do not come through whole is imported without
 * them (it can be opened in the play view, saved as gts, and gets its files
 * back when the same PDF or photos are opened again).
 */

import type { GtsDocument } from "@guitarmr/gts";
import type { LibraryEntry, StoredFile } from "./library.ts";

export const LIBRARY_FORMAT = "guitarmr-library";
export const LIBRARY_VERSION = 1;
/** Raw bytes per chunk line (a multiple of 3, so each line is base64 on its own). */
export const CHUNK_BYTES = 3 * 256 * 1024;

interface FileInfo {
  name: string;
  type: string;
  size: number;
  sha256: string;
}

type ExportedEntry = Omit<LibraryEntry, "files"> & { files: FileInfo[] };

type LibraryRecord =
  | { format: typeof LIBRARY_FORMAT; version: number; exported: string; entries: number; files: number; bytes: number }
  | { type: "entry"; entry: ExportedEntry }
  | { type: "chunk"; entry: string; file: number; seq: number; count: number; data: string }
  | { type: "end"; entries: number; chunks: number };

async function sha256Of(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/**
 * The export as lines: header, every entry with its gts document (most
 * recently used first), then with `files` the files' chunks, smallest
 * file first, and an end mark.
 */
export async function exportLibrary(entries: readonly LibraryEntry[], options: { files: boolean }, now = new Date()): Promise<string[]> {
  const sorted = [...entries].sort((a, b) => b.updated - a.updated);
  const infos = await Promise.all(
    sorted.map((e) =>
      Promise.all(e.files.map(async (f) => ({ name: f.name, type: f.type, size: f.data.byteLength, sha256: await sha256Of(f.data) }))),
    ),
  );
  const files = options.files
    ? sorted.flatMap((e) => e.files.map((f, index) => ({ entry: e.id, index, data: new Uint8Array(f.data) })))
    : [];
  files.sort((a, b) => a.data.length - b.data.length);
  const lines: string[] = [];
  const put = (record: LibraryRecord) => lines.push(JSON.stringify(record));
  put({
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    exported: now.toISOString(),
    entries: sorted.length,
    files: files.length,
    bytes: files.reduce((n, f) => n + f.data.length, 0),
  });
  sorted.forEach((e, i) => put({ type: "entry", entry: { ...e, files: options.files ? infos[i]! : [] } }));
  let chunks = 0;
  for (const f of files) {
    const count = Math.max(Math.ceil(f.data.length / CHUNK_BYTES), 1);
    for (let seq = 0; seq < count; seq++) {
      put({ type: "chunk", entry: f.entry, file: f.index, seq, count, data: toBase64(f.data.subarray(seq * CHUNK_BYTES, (seq + 1) * CHUNK_BYTES)) });
      chunks++;
    }
  }
  put({ type: "end", entries: sorted.length, chunks });
  return lines;
}

export interface ImportResult {
  entries: LibraryEntry[];
  /** Names of scores whose files did not come through whole (imported without them). */
  withoutFiles: string[];
  /** Lines that could not be read. */
  skipped: number;
  /** The file ends before its end mark (cut short on the way). */
  truncated: boolean;
}

/** Is this the first line of a library export? */
export const isLibraryExport = (head: string): boolean => head.trimStart().startsWith(`{"format":"${LIBRARY_FORMAT}"`);

const isDoc = (v: unknown): v is GtsDocument =>
  typeof v === "object" && v !== null && (v as GtsDocument).format === "gts" && Array.isArray((v as GtsDocument).sections);

/** Read an export line by line; throws only when it is not a library export at all. */
export async function importLibrary(lines: AsyncIterable<string> | Iterable<string>): Promise<ImportResult> {
  const entries = new Map<string, ExportedEntry>();
  const chunks = new Map<string, { count: number; parts: Map<number, Uint8Array> }>();
  let header = false;
  let ended = false;
  let skipped = 0;
  for await (const line of lines) {
    if (!line.trim()) continue;
    let record: LibraryRecord;
    try {
      record = JSON.parse(line) as LibraryRecord;
    } catch {
      if (!header) throw new Error("ライブラリの書き出しファイルではありません");
      skipped++;
      continue;
    }
    if (!header) {
      if (!("format" in record) || record.format !== LIBRARY_FORMAT) throw new Error("ライブラリの書き出しファイルではありません");
      if (record.version > LIBRARY_VERSION) throw new Error("新しい版のアプリで書き出されたファイルです");
      header = true;
      continue;
    }
    if (!("type" in record)) {
      skipped++;
    } else if (record.type === "entry") {
      const e = record.entry;
      if (typeof e?.id === "string" && typeof e.name === "string" && Array.isArray(e.files)) {
        entries.set(e.id, { ...e, doc: isDoc(e.doc) ? e.doc : null });
      } else skipped++;
    } else if (record.type === "chunk") {
      try {
        const key = `${record.entry}/${record.file}`;
        const file = chunks.get(key) ?? { count: record.count, parts: new Map<number, Uint8Array>() };
        file.parts.set(record.seq, fromBase64(record.data));
        chunks.set(key, file);
      } catch {
        skipped++;
      }
    } else if (record.type === "end") {
      ended = true;
    } else skipped++;
  }
  if (!header) throw new Error("ライブラリの書き出しファイルではありません");

  const result: ImportResult = { entries: [], withoutFiles: [], skipped, truncated: !ended };
  for (const e of entries.values()) {
    const files: StoredFile[] = [];
    for (const [i, info] of e.files.entries()) {
      const chunked = chunks.get(`${e.id}/${i}`);
      if (!chunked || ![...Array(chunked.count).keys()].every((s) => chunked.parts.has(s))) break;
      const data = new Uint8Array(info.size);
      let offset = 0;
      for (let s = 0; s < chunked.count; s++) {
        const part = chunked.parts.get(s)!;
        if (offset + part.length > info.size) break;
        data.set(part, offset);
        offset += part.length;
      }
      if (offset !== info.size || (await sha256Of(data)) !== info.sha256) break;
      files.push({ name: info.name, type: info.type, data: data.buffer });
    }
    // All or nothing: the score's pages (and its id) depend on every file.
    const whole = files.length === e.files.length;
    if (!whole) result.withoutFiles.push(e.name);
    result.entries.push({ ...e, files: whole ? files : [] });
  }
  return result;
}

/**
 * An imported entry merged with the one already on this device: the newer
 * work wins, files on the device are kept (else the imported ones are used).
 */
export function mergeEntry(local: LibraryEntry | undefined, incoming: LibraryEntry): LibraryEntry {
  if (!local) return incoming;
  const newer = incoming.updated > local.updated ? incoming : local;
  const older = newer === incoming ? local : incoming;
  return {
    ...newer,
    doc: newer.doc ?? older.doc,
    files: local.files.length ? local.files : incoming.files,
    added: Math.min(local.added, incoming.added),
    updated: Math.max(local.updated, incoming.updated),
  };
}

/** Lines of a text file, read as a stream (exports with photos can be large). */
export async function* linesOf(file: Blob): AsyncGenerator<string> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let rest = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += value;
    const parts = rest.split("\n");
    rest = parts.pop()!;
    yield* parts;
  }
  if (rest) yield rest;
}

/**
 * The library on this device: every score opened here keeps its source
 * files (the PDF, or the photos) and the work on it (the gts document) in
 * this browser's IndexedDB, so it can be opened again, analyzed again and
 * continued without picking the files again. Nothing in it leaves the
 * device; it is gone when the browser's site data is cleared, which is why
 * saving the gts file is still offered.
 *
 * Storage can be missing or blocked (private windows, some in-app
 * browsers): every call then resolves to an empty result and the page
 * keeps working with what is in memory.
 */

import type { GtsDocument } from "@guitarmr/gts";

export interface StoredFile {
  name: string;
  type: string;
  /** The file's bytes (an ArrayBuffer: older iOS Safari could not store Blobs). */
  data: ArrayBuffer;
}

export interface LibraryEntry {
  /** SHA-256 of the source, as in the gts `source.sha256`. */
  id: string;
  name: string;
  kind: "pdf" | "photos" | "sample";
  /** Empty for the built-in samples, which are part of the page. */
  files: StoredFile[];
  /** The work in progress; null until something was done (or after starting over). */
  doc: GtsDocument | null;
  added: number;
  updated: number;
}

const LIBRARY_DB = "guitarmr";
const LIBRARY_STORE = "scores";

let libraryOpened: Promise<IDBDatabase | null> | null = null;

function libraryDatabase(): Promise<IDBDatabase | null> {
  libraryOpened ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(LIBRARY_DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(LIBRARY_STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return libraryOpened;
}

/** One request in its own transaction; null when storage is unavailable or the request failed. */
async function libraryRequest<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<{ value: T } | null> {
  const db = await libraryDatabase();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(LIBRARY_STORE, mode);
      const req = make(tx.objectStore(LIBRARY_STORE));
      tx.oncomplete = () => resolve({ value: req.result });
      tx.onerror = tx.onabort = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let persistAsked = false;

export const library = {
  available: async (): Promise<boolean> => (await libraryDatabase()) !== null,

  /** User scores, most recently used first (built-in samples are left out). */
  async list(): Promise<LibraryEntry[]> {
    const all = (await libraryRequest<LibraryEntry[]>("readonly", (s) => s.getAll()))?.value ?? [];
    return all.filter((e) => e.kind !== "sample").sort((a, b) => b.updated - a.updated);
  },

  /** Every entry, samples included (for export). */
  all: async (): Promise<LibraryEntry[]> => (await libraryRequest<LibraryEntry[]>("readonly", (s) => s.getAll()))?.value ?? [],

  get: async (id: string): Promise<LibraryEntry | undefined> =>
    (await libraryRequest<LibraryEntry | undefined>("readonly", (s) => s.get(id)))?.value,

  /** Store an entry; false when it could not be stored (storage blocked or full). */
  async put(entry: LibraryEntry): Promise<boolean> {
    const ok = (await libraryRequest("readwrite", (s) => s.put(entry))) !== null;
    if (ok && entry.files.length && !persistAsked) {
      // Ask the browser not to evict the library under storage pressure.
      persistAsked = true;
      void navigator.storage?.persist?.().catch(() => false);
    }
    return ok;
  },

  /** Keep `doc` as the work on entry `id` (created bare for samples), marking it used now. */
  async saveDoc(id: string, doc: GtsDocument | null, fallback: Omit<LibraryEntry, "doc" | "updated">): Promise<boolean> {
    const entry = (await library.get(id)) ?? { ...fallback, doc: null, updated: 0 };
    return library.put({ ...entry, doc, updated: Date.now() });
  },

  remove: async (id: string): Promise<boolean> => (await libraryRequest("readwrite", (s) => s.delete(id))) !== null,

  /** Bytes used by this page's storage, when the browser tells. */
  async usage(): Promise<number | null> {
    try {
      return (await navigator.storage?.estimate?.())?.usage ?? null;
    } catch {
      return null;
    }
  },
};

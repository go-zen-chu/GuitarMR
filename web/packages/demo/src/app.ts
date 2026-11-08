/**
 * The phone page (tky): the scores read so far come first; scanning is a
 * screen of its own: pick a PDF or take photos of the pages, render or
 * decode them, detect every page in the worker (photos are corrected first:
 * the sheet cut out, perspective and lighting fixed), and the score opens.
 * There Claude reads chords and structure from the measure images, they are
 * reviewed and corrected measure by measure, played and saved as a gts file.
 * The files and the work stay on the device (the library, in IndexedDB);
 * only the system images go to Claude, on the viewer's own claude.ai account.
 *
 * The core packages are not imported at run time: scripts/build.ts puts
 * them in a classic script before this module (their functions become
 * globals) and in the worker; the imports below are for type checking only.
 */

import { type GtsDocument, measures } from "@guitarmr/gts";
import { checkDocument, reviewSummary, tabUnread } from "@guitarmr/extract";
import { type RgbaImage, type ScannedPage, buildDocument, renderPages, sha256Hex } from "@guitarmr/layoutscan";
import * as pdfjs from "pdfjs-dist";
import { coverArt, coverPixels, coverUrl } from "./cover.ts";
import { createEditor } from "./editor.ts";
import { type LibraryEntry, type StoredFile, library } from "./library.ts";
import { type PhotoFile, concatPhotos, createTray, decodePhoto, isImage } from "./photos.ts";
import { exportLibrary, importLibrary, isLibraryExport, linesOf, mergeEntry } from "./transfer.ts";
import { createPlayer, prettyChord } from "./player.ts";
import type { DetectResult } from "./preview.ts";
import { type ReadLayer, type Sample, readPages } from "./reader.ts";
import { type Route, parentRoute, parseRoute, routeHash } from "./router.ts";
import { type PageView, drawPage, statusOf } from "./score-view.ts";

/** Replaced by scripts/build.ts with the pdf.js worker on the CDN. */
const PDFJS_WORKER = "@PDFJS_WORKER@";

interface SampleFile {
  file: string;
  label: string;
  note: string;
  pdf: string; // base64
}

interface Downloads {
  save(request: { filename: string; data: string }): Promise<{ status: string }>;
}
/** The Android app's own dialog to change or remove the Claude API key. */
interface ApiKeySettings {
  open(): void;
}
const claude = (globalThis as { claude?: { use(name: string): Promise<unknown> } }).claude;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const ui = {
  views: {
    library: $<HTMLElement>("view-library"),
    scan: $<HTMLElement>("view-scan"),
    score: $<HTMLElement>("view-score"),
    settings: $<HTMLElement>("view-settings"),
  } satisfies Record<Route["view"], HTMLElement>,
  tabs: [...document.querySelectorAll<HTMLAnchorElement>(".tabs [data-tab]")],
  settingsLink: $<HTMLAnchorElement>("settings-link"),
  apiKey: $<HTMLElement>("api-key"),
  apiKeyOpen: $<HTMLButtonElement>("api-key-open"),
  file: $<HTMLInputElement>("pdf-file"),
  camera: $<HTMLInputElement>("camera"),
  trayCamera: $<HTMLInputElement>("tray-camera"),
  trayFile: $<HTMLInputElement>("tray-file"),
  library: $<HTMLElement>("library"),
  libraryList: $<HTMLUListElement>("library-list"),
  libraryNote: $<HTMLElement>("library-note"),
  libraryEmpty: $<HTMLElement>("library-empty"),
  libraryUnavailable: $<HTMLElement>("library-unavailable"),
  libraryExport: $<HTMLButtonElement>("library-export"),
  libraryWithFiles: $<HTMLInputElement>("library-with-files"),
  libraryImport: $<HTMLInputElement>("library-import"),
  libraryMessage: $<HTMLElement>("library-message"),
  samples: $<HTMLDivElement>("samples"),
  statusBox: $<HTMLElement>("status-box"),
  status: $<HTMLParagraphElement>("status"),
  progress: $<HTMLProgressElement>("progress"),
  summary: $<HTMLElement>("summary"),
  source: $<HTMLElement>("summary-source"),
  stats: $<HTMLElement>("summary-stats"),
  review: $<HTMLElement>("review-summary"),
  nextAttention: $<HTMLButtonElement>("next-attention"),
  draftNote: $<HTMLElement>("draft-note"),
  discardDraft: $<HTMLButtonElement>("discard-draft"),
  ai: $<HTMLElement>("ai"),
  read: $<HTMLButtonElement>("read"),
  readTab: $<HTMLButtonElement>("read-tab"),
  checks: $<HTMLDetailsElement>("checks"),
  checksTitle: $<HTMLElement>("checks-title"),
  checksList: $<HTMLUListElement>("checks-list"),
  stop: $<HTMLButtonElement>("stop"),
  readStatus: $<HTMLElement>("read-status"),
  readWarnings: $<HTMLDetailsElement>("read-warnings"),
  save: $<HTMLButtonElement>("save"),
  copy: $<HTMLButtonElement>("copy"),
  openGts: $<HTMLInputElement>("gts-file"),
  saveNote: $<HTMLParagraphElement>("save-note"),
  json: $<HTMLTextAreaElement>("json"),
  playOpen: $<HTMLButtonElement>("play-open"),
  playGts: $<HTMLInputElement>("play-gts"),
  sampleList: $<HTMLUListElement>("sample-list"),
  pages: $<HTMLOListElement>("pages"),
};

pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

const worker = new Worker(
  URL.createObjectURL(
    // One function scope: global lookups of the many core helpers are slow.
    new Blob(["(() => {\n", $("layoutscan-core").textContent!, $("layoutscan-worker").textContent!, "\n})();"], {
      type: "text/javascript",
    }),
  ),
);
const pending = new Map<number, (r: DetectResult & { error?: string }) => void>();
worker.onmessage = (event: MessageEvent<DetectResult & { error?: string }>) => {
  pending.get(event.data.index)?.(event.data);
  pending.delete(event.data.index);
};
const detectInWorker = (index: number, image: RgbaImage, photo = false): Promise<DetectResult> =>
  new Promise((resolve, reject) => {
    pending.set(index, (r) => (r.error ? reject(new Error(r.error)) : resolve(r)));
    worker.postMessage({ index, image, photo }, [image.data.buffer as ArrayBuffer]);
  });

/** What a score is made from: a PDF, or photos (one per page). */
type Source =
  | { kind: "pdf" | "sample"; name: string; bytes: Uint8Array }
  | { kind: "photos"; name: string; photos: PhotoFile[] };

/** Everything about the score on screen. */
const state = {
  name: "",
  kind: "pdf" as Source["kind"],
  sha256: "",
  /** Object URLs of the original photos, per page. */
  photoUrls: [] as string[],
  /** The layout-only document from detection, to start over from. */
  detected: null as GtsDocument | null,
  doc: null as GtsDocument | null,
  pages: new Map<number, PageView>(),
  selected: null as string | null,
};

let run = 0; // a newer analysis cancels the running one

function setStatus(text: string, progress: number | null = null) {
  ui.statusBox.hidden = !text && progress === null;
  ui.status.textContent = text;
  ui.progress.hidden = progress === null;
  if (progress !== null) ui.progress.value = progress;
}

const outputName = () => state.name.replace(/\.(pdf|jpe?g|png|heic|heif|webp)$/i, "") + ".gts.json";
const json = () => `${JSON.stringify(state.doc, null, 2)}\n`;

// The work in progress is kept in the library on this device, per source.
// Drafts of earlier versions were kept in localStorage; they are moved over.
const DRAFT_PREFIX = "guitarmr.draft.";
function saveDraft() {
  const doc = state.doc;
  if (!doc) return;
  void library
    .saveDoc(state.sha256, doc, { id: state.sha256, name: state.name, kind: state.kind, files: [], added: Date.now() })
    .then(() => renderLibrary());
}
function legacyDraft(sha256: string): GtsDocument | null {
  try {
    const doc = JSON.parse(localStorage.getItem(DRAFT_PREFIX + sha256) ?? "null") as GtsDocument | null;
    return doc?.format === "gts" && doc.source?.sha256 === sha256 ? doc : null;
  } catch {
    return null;
  }
}
function dropDraft() {
  try {
    localStorage.removeItem(DRAFT_PREFIX + state.sha256);
  } catch {
    // ignore
  }
  void library.get(state.sha256).then((entry) => entry && library.put({ ...entry, doc: state.detected, updated: Date.now() }));
}

/** Make `doc` the current document and bring every view up to date. */
function commit(doc: GtsDocument, persist = true) {
  state.doc = doc;
  for (const view of state.pages.values()) drawPage(view, doc, state.selected);
  const s = reviewSummary(doc);
  const parts = [
    ["確認済み", s.reviewed, "reviewed"],
    ["要確認", s.attention, "attention"],
    ["AI", s.auto, "auto"],
    ["未読", s.unread, "unread"],
  ] as const;
  ui.review.replaceChildren(
    ...parts
      .filter(([, n]) => n > 0)
      .map(([label, n, cls]) => {
        const chip = document.createElement("span");
        chip.className = `chip s-${cls}`;
        chip.textContent = `${label} ${n}`;
        return chip;
      }),
  );
  ui.nextAttention.hidden = s.attention === 0;
  const layers = doc.meta.layers ?? [];
  ui.stats.textContent = [
    `${state.pages.size} ページ`,
    `${s.total} 小節`,
    `レイヤー: ${layers.join(", ")}`,
  ].join(" · ");
  ui.read.textContent = s.unread === s.total ? "読み取る" : `続きを読む（未読 ${s.unread} 小節）`;
  ui.read.hidden = s.unread === 0;
  // The tab is read after structure and chords (repeat-sign measures need none).
  const tabLeft = tabUnread(doc).length;
  ui.readTab.hidden = s.unread > 0 || tabLeft === 0;
  ui.readTab.textContent = tabLeft === s.total ? "TAB（リズム・フレット）を読む" : `TAB の続きを読む（${tabLeft} 小節）`;
  renderChecks(doc);
  ui.json.value = json();
  ui.save.textContent = `${outputName()} を保存`;
  editor.refresh();
  if (persist) saveDraft();
}

/** Every check that fails, each one a button to its measure. */
function renderChecks(doc: GtsDocument) {
  const issues = checkDocument(doc);
  ui.checks.hidden = issues.length === 0;
  ui.checksTitle.textContent = `チェックで見つかったこと（${issues.length} 件）`;
  ui.checksList.replaceChildren(
    ...issues.map((issue) => {
      const li = document.createElement("li");
      const button = document.createElement("button");
      button.type = "button";
      button.className = `issue k-${issue.kind}`;
      button.textContent = issue.message;
      button.addEventListener("click", () => issue.ids[0] && editor.open(issue.ids[0]));
      li.append(button);
      return li;
    }),
  );
}

function select(id: string | null) {
  state.selected = id;
  if (state.doc) for (const view of state.pages.values()) drawPage(view, state.doc, id);
  if (id) {
    // Bring the measure to the top of the screen, above the editor sheet.
    const box = ui.pages.querySelector(`[data-id="${CSS.escape(id)}"] .box`);
    if (box) {
      const top = box.getBoundingClientRect().top + scrollY - 16;
      scrollTo({ top, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }
}

const editor = createEditor({
  doc: () => state.doc!,
  pageImage: (page) => {
    const view = state.pages.get(page);
    return view && { url: view.url, width: view.width, height: view.height };
  },
  commit,
  select,
});

function pageCard(result: DetectResult, preview: { blob: Blob; url: string } | null, photoUrl?: string): HTMLLIElement {
  const { layout } = result;
  const li = document.createElement("li");
  li.className = "page";
  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h3");
  title.textContent = `p${result.index + 1}`;
  head.append(title);
  const original = photoUrl ? photoFigure(photoUrl, result.paper ?? null) : null;
  if (!preview || !result.preview) {
    li.classList.add("skipped");
    const note = document.createElement("p");
    note.textContent = photoUrl
      ? "段が見つからないためスキップしました（TAB譜の6本線が写っているか、ぶれていないか確かめてください）"
      : "段が見つからないためスキップしました（歌詞だけのページなど）";
    head.append(note);
    li.append(head);
    if (original) li.append(original);
    return li;
  }
  const facts = document.createElement("dl");
  for (const [term, value] of [
    ...(photoUrl ? ([["用紙", result.paper ? "切り出して補正" : "見つからず全体を補正"]] as const) : []),
    ["向き", layout.rotation === 0 ? "そのまま" : `${layout.rotation}° 回転`],
    ["傾き", `${layout.skew.toFixed(2)}°`],
    ["段", `${layout.systems.length}`],
    ["解析", `${(result.ms / 1000).toFixed(1)} 秒`],
  ] as const) {
    const div = document.createElement("div");
    const dt = document.createElement("dt");
    const dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    div.append(dt, dd);
    facts.append(div);
  }
  head.append(facts);
  const reread = document.createElement("button");
  reread.type = "button";
  reread.className = "reread";
  reread.textContent = "このページを読み直す";
  reread.title = "このページの修正は上書きされます";
  reread.hidden = ui.ai.hidden;
  reread.addEventListener("click", () => void read([result.index]));
  head.append(reread);
  const figure = document.createElement("div");
  figure.className = "figure";
  const img = document.createElement("img");
  img.src = preview.url;
  img.alt = `p${result.index + 1} の譜面`;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "overlay");
  figure.append(img, svg);
  li.append(head, figure);
  if (original) li.append(original);
  state.pages.set(result.index, {
    index: result.index,
    width: result.preview.width,
    height: result.preview.height,
    scale: result.scale,
    layout,
    image: preview.blob,
    url: preview.url,
    svg,
  });
  return li;
}

/** The original photo with the outline of the sheet found in it, folded away. */
function photoFigure(url: string, paper: [number, number][] | null): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "original";
  const summary = document.createElement("summary");
  summary.textContent = paper ? "元の写真と切り出した用紙の範囲" : "元の写真（用紙が見つからなかったので全体を使いました）";
  const figure = document.createElement("div");
  figure.className = "figure";
  const img = document.createElement("img");
  img.src = url;
  img.alt = "元の写真";
  figure.append(img);
  if (paper) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "overlay");
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
    const outline = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    outline.setAttribute("class", "paper");
    outline.setAttribute("points", paper.map(([x, y]) => `${x},${y}`).join(" "));
    svg.append(outline);
    figure.append(svg);
  }
  details.append(summary, figure);
  return details;
}

/** RGBA preview → JPEG blob (keeps memory low with many pages). */
async function toJpeg(image: RgbaImage): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  canvas.width = 0;
  if (!blob) throw new Error("JPEG encoding failed");
  return blob;
}

function reset() {
  editor.close();
  readAbort?.abort();
  for (const view of state.pages.values()) URL.revokeObjectURL(view.url);
  for (const url of state.photoUrls) URL.revokeObjectURL(url);
  state.photoUrls = [];
  state.pages.clear();
  state.doc = state.detected = null;
  state.sha256 = "";
  ui.summary.hidden = true;
  ui.pages.replaceChildren();
}

/** Rendered PDF pages, or decoded photos, as [index, pixels, is a photo]. */
async function* pagesOf(source: Source): AsyncGenerator<[number, RgbaImage, boolean]> {
  if (source.kind === "photos") {
    for (const [index, photo] of source.photos.entries()) yield [index, await decodePhoto(photo), true];
    return;
  }
  for await (const [index, image] of renderPages(pdfjs as never, source.bytes)) yield [index, image, false];
}

async function pageCount(source: Source): Promise<number> {
  if (source.kind === "photos") return source.photos.length;
  const task = pdfjs.getDocument({ data: source.bytes.slice() });
  const total = (await task.promise).numPages;
  await task.destroy();
  return total;
}

const filesOf = (source: Source): StoredFile[] =>
  source.kind === "photos"
    ? source.photos.map((p) => ({ name: p.name, type: p.type, data: p.bytes.slice().buffer }))
    : source.kind === "pdf"
      ? [{ name: source.name, type: "application/pdf", data: source.bytes.slice().buffer }]
      : [];

async function analyze(source: Source) {
  const mine = ++run;
  reset();
  const { name } = source;
  state.name = name;
  state.kind = source.kind;
  setStatus(`${name} を読み込み中…`, 0);
  const scanned: ScannedPage[] = [];
  let total = 0;
  let done = 0;
  let sha256: string;
  let cover: string | undefined;
  try {
    total = await pageCount(source);
    for await (const [index, image, photo] of pagesOf(source)) {
      if (mine !== run) return;
      setStatus(`${name}: ${index + 1} / ${total} ${photo ? "枚目の写真を補正・解析中…" : "ページ目を解析中…"}`, done / total);
      const firstPage = index === 0 ? coverPixels(image) : null;
      const result = await detectInWorker(index, image, photo);
      if (mine !== run) return;
      if (firstPage) cover = coverUrl(result.preview ? coverPixels(result.preview) : firstPage);
      let preview = null;
      if (result.preview) {
        const blob = await toJpeg(result.preview);
        preview = { blob, url: URL.createObjectURL(blob) };
      }
      let photoUrl: string | undefined;
      if (source.kind === "photos") {
        const p = source.photos[index]!;
        photoUrl = URL.createObjectURL(new Blob([p.bytes as Uint8Array<ArrayBuffer>], { type: p.type }));
        state.photoUrls.push(photoUrl);
      }
      ui.pages.append(pageCard(result, preview, photoUrl));
      if (result.layout.systems.length) {
        scanned.push({
          index,
          layout: result.layout,
          ...(source.kind === "photos" ? { file: source.photos[index]!.name } : {}),
          ...(result.paper ? { paper: result.paper } : {}),
        });
      }
      done++;
    }
    sha256 = await sha256Hex(source.kind === "photos" ? concatPhotos(source.photos) : source.bytes);
  } catch (e) {
    if (mine === run) setStatus(`${name} を処理できませんでした（${(e as Error).message}）。`);
    return;
  }
  if (mine !== run) return;
  if (scanned.length === 0) {
    setStatus(
      source.kind === "photos"
        ? `${name}: どの写真にも段（TAB譜の6本線）が見つかりませんでした。紙全体が入るように、明るい場所で撮り直してください。`
        : `${name}: どのページにも段（TAB譜の6本線）が見つかりませんでした。`,
    );
    return;
  }
  state.sha256 = sha256;
  state.detected = buildDocument(name, sha256, scanned);
  // The library keeps the files (so the score can be opened again) and the work on them.
  const entry = await library.get(sha256);
  if (mine !== run) return;
  const legacy = entry?.doc ? null : legacyDraft(sha256);
  const draft = entry?.doc ?? legacy;
  const now = Date.now();
  const stored: LibraryEntry = entry
    ? { ...entry, updated: now, files: entry.files.length ? entry.files : filesOf(source) }
    : { id: sha256, name, kind: source.kind, files: filesOf(source), doc: null, added: now, updated: now };
  if (cover) stored.cover = cover;
  // The detected layout is already work worth keeping (and moving to another device).
  stored.doc = draft ?? state.detected;
  const kept = await library.put(stored);
  if (kept && legacy) dropLegacy(sha256);
  if (mine !== run) return;
  // Only work beyond the detection counts as a draft to tell about.
  ui.draftNote.hidden = !draft || JSON.stringify(draft) === JSON.stringify(state.detected);
  ui.source.textContent = name;
  ui.saveNote.textContent = kept || source.kind === "sample" ? "" : "この画面では端末に保存できません。作業が終わったら gts.json を保存してください。";
  ui.readStatus.textContent = "";
  ui.readWarnings.hidden = true;
  ui.summary.hidden = false;
  commit(draft ?? state.detected, false);
  setStatus("");
  void renderLibrary();
  // A finished scan opens its score; one finished while the viewer went elsewhere waits in the list.
  if (route.view === "scan" || route.view === "score") navigate({ view: "score", id: sha256 }, route.view === "score");
}

function dropLegacy(sha256: string) {
  try {
    localStorage.removeItem(DRAFT_PREFIX + sha256);
  } catch {
    // ignore
  }
}

// Reading with Claude (claude.ai "sample" capability).
let sample: Sample | null = null;
let readAbort: AbortController | null = null;

async function read(pages?: number[], layer: ReadLayer = "structure") {
  if (!sample || !state.doc || readAbort) return;
  const left = layer === "tab" ? new Set(tabUnread(state.doc)) : null;
  const todo =
    pages ??
    [
      ...new Set(
        measures(state.doc)
          .filter((m) => (left ? left.has(m.id!) : statusOf(m) === "unread"))
          .map((m) => m.region!.page),
      ),
    ].sort((a, b) => a - b);
  if (!todo.length) return;
  readAbort = new AbortController();
  ui.read.disabled = ui.readTab.disabled = true;
  ui.stop.hidden = false;
  ui.readWarnings.hidden = true;
  const started = Date.now();
  let label = "";
  const tick = setInterval(() => {
    ui.readStatus.textContent = `${label}${Math.round((Date.now() - started) / 1000)} 秒`;
  }, 1000);
  const result = await readPages(
    sample,
    {
      doc: () => state.doc!,
      commit,
      pageImage: (page) => {
        const view = state.pages.get(page);
        return view && { blob: view.image, width: view.width, height: view.height };
      },
      progress: (text) => {
        label = `${text} `;
      },
    },
    todo,
    readAbort.signal,
    layer,
  );
  clearInterval(tick);
  readAbort = null;
  ui.read.disabled = ui.readTab.disabled = false;
  ui.stop.hidden = true;
  const s = reviewSummary(state.doc);
  const messages: Record<string, string> = {
    cancelled: "止めました。「続きを読む」で未読のページから再開できます。",
    rate_limited: "Claude の利用上限に達しました。時間をおいて「続きを読む」を押してください。",
    not_granted: "Claude の利用が許可されませんでした。",
    upstream_error: "Claude に接続できませんでした。少し待ってからもう一度押してください。",
    invalid_api_key: "Claude API キーが使えませんでした。もう一度押すとキーを入れ直せます。",
  };
  if (result.error) {
    ui.readStatus.textContent =
      messages[result.error.code] ?? `この画面では AI で読み取れません（${result.error.code}）。`;
    if (["not_granted", "sampling_disabled", "images_unavailable", "unavailable"].includes(result.error.code)) hideAi();
  } else {
    ui.readStatus.textContent =
      s.attention > 0
        ? `読み終わりました。要確認の ${s.attention} 小節から見直してください（枠をタップすると直せます）。`
        : "読み終わりました。枠をタップすると内容を確認・修正できます。";
  }
  if (result.warnings.length) {
    ui.readWarnings.hidden = false;
    ui.readWarnings.querySelector("ul")!.replaceChildren(
      ...result.warnings.map((w) => {
        const li = document.createElement("li");
        li.textContent = w;
        return li;
      }),
    );
  }
}

function hideAi() {
  ui.ai.hidden = true;
  for (const b of ui.pages.querySelectorAll<HTMLButtonElement>(".reread")) b.hidden = true;
}

async function setUpAi() {
  sample = ((await claude?.use("sample")) as Sample | null | undefined) ?? null;
  const images = sample ? (await sample.limits().catch(() => null))?.images : undefined;
  if (!sample || !images) {
    sample = null;
    return;
  }
  ui.ai.hidden = false;
  for (const b of ui.pages.querySelectorAll<HTMLButtonElement>(".reread")) b.hidden = false;
}

/** Save a text file: the claude.ai save dialog, or a plain download outside claude.ai. Returns what to tell the viewer. */
async function saveText(filename: string, data: string, type: string, done: string): Promise<string> {
  const downloads = (await claude?.use("downloads")) as Downloads | null | undefined;
  if (downloads) {
    try {
      await downloads.save({ filename, data });
      return done;
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === "declined" ? "保存をキャンセルしました。" : "この画面では保存できません。";
    }
  }
  if (claude) return "この画面では保存できません。";
  // Opened as a plain file outside claude.ai: an ordinary download works.
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  return done;
}

async function save() {
  if (!state.doc) return;
  const note = await saveText(outputName(), json(), "application/json", "保存しました。PDFと同じ場所に置くと Quest のアプリが読み込めます。");
  ui.saveNote.textContent = note === "この画面では保存できません。" ? `${note}「JSONをコピー」を使ってください。` : note;
}

async function copy() {
  if (!state.doc) return;
  try {
    await navigator.clipboard.writeText(json());
    ui.saveNote.textContent = "JSONをコピーしました。";
  } catch {
    const details = ui.json.closest("details");
    if (details) details.open = true;
    ui.json.focus();
    ui.json.select();
    ui.saveNote.textContent = "コピーできなかったので全体を選択しました。共有メニューからコピーしてください。";
  }
}

/** Continue from a gts file saved earlier for the same PDF. */
async function openGts(file: File) {
  try {
    const doc = JSON.parse(await file.text()) as GtsDocument;
    if (doc?.format !== "gts" || !Array.isArray(doc.sections)) throw new Error("gts ではありません");
    if (doc.source?.sha256 !== state.sha256) {
      ui.saveNote.textContent = `${file.name} は、いま開いている PDF の gts ではありません（PDF の内容が違います）。`;
      return;
    }
    editor.close();
    commit(doc);
    ui.draftNote.hidden = true;
    ui.saveNote.textContent = `${file.name} を開きました。`;
    navigate({ view: "score", id: state.sha256 });
  } catch (e) {
    ui.saveNote.textContent = `${file.name} を開けませんでした（${(e as Error).message}）。`;
  }
}

// The play view: from the score being worked on, a gts file alone, or a sample.
const player = createPlayer();

/** A gts file picked for the play view (no PDF needed). */
async function playFile(file: File) {
  try {
    const doc = JSON.parse(await file.text()) as GtsDocument;
    if (doc?.format !== "gts" || !Array.isArray(doc.sections) || !doc.meta) throw new Error("gts ではありません");
    player.open(doc);
  } catch (e) {
    setStatus(`${file.name} を演奏ビューで開けませんでした（${(e as Error).message}）。`);
  }
}

const scores: { label: string; note: string; gts: GtsDocument }[] = JSON.parse($("scores-data").textContent!);
ui.playOpen.addEventListener("click", () => state.doc && player.open(state.doc));
ui.playGts.addEventListener("change", () => {
  const file = ui.playGts.files?.[0];
  ui.playGts.value = "";
  if (file) void playFile(file);
});

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const samples: SampleFile[] = JSON.parse($("samples-data").textContent!);
let sampleIds: Promise<Map<string, SampleFile>> | null = null;
/** The built-in samples by the SHA-256 of their PDFs (hashed once, on first use). */
const samplesById = (): Promise<Map<string, SampleFile>> =>
  (sampleIds ??= Promise.all(samples.map(async (s) => [await sha256Hex(decode(s.pdf)), s] as const)).then((pairs) => new Map(pairs)));
/** The built-in sample whose PDF has the SHA-256 `id`, if any. */
const sampleById = async (id: string): Promise<SampleFile | undefined> => (await samplesById()).get(id);

/** A sample song of the score list: its scan-like PDF, its finished gts file, or both. */
interface SampleSong {
  label: string;
  notes: string[];
  pdf?: SampleFile;
  gts?: GtsDocument;
}
const sampleSongs: SampleSong[] = [...new Set([...samples.map((s) => s.label), ...scores.map((s) => s.label)])].map((label) => {
  const pdf = samples.find((s) => s.label === label);
  const gts = scores.find((s) => s.label === label);
  return { label, notes: [pdf?.note, gts?.note].filter((n): n is string => !!n), ...(pdf ? { pdf } : {}), ...(gts ? { gts: gts.gts } : {}) };
});
for (const s of samples) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sample";
  button.innerHTML = "<span></span><small></small>";
  button.querySelector("span")!.textContent = s.label;
  button.querySelector("small")!.textContent = s.note;
  button.addEventListener("click", () => analyze({ kind: "sample", name: s.file, bytes: decode(s.pdf) }));
  ui.samples.append(button);
}

// Photos wait in the tray until they are analyzed together, one per page.
const tray = createTray({
  analyze: (photos) => void analyze({ kind: "photos", name: photos[0]!.name, photos }),
});

/**
 * Read picked or dropped files; any file type is accepted, the bytes decide:
 * a PDF is analyzed, photos go to the tray, a gts file continues the open score.
 */
async function openFiles(files: File[]) {
  if (!files.length) return;
  run++; // stop a running analysis right away
  setStatus(`${files.length === 1 ? files[0]!.name : `${files.length} 個のファイル`} を読み込み中…`, 0);
  const photos: PhotoFile[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      // e.g. an iCloud/Drive file that is not on the device yet
      setStatus(`${file.name} を読めませんでした（${(e as Error).message}）。端末にダウンロードしてから選んでください。`);
      return;
    }
    const head = new TextDecoder().decode(bytes.subarray(0, 1024));
    if (files.length === 1 && isLibraryExport(head)) {
      setStatus("");
      navigate({ view: "settings" });
      return importFile(file);
    }
    if (files.length === 1 && head.trimStart().startsWith("{") && state.doc) {
      setStatus("");
      return openGts(file);
    }
    if (head.indexOf("%PDF-") >= 0) {
      tray.clear();
      navigate({ view: "scan" });
      return analyze({ kind: "pdf", name: file.name, bytes });
    }
    if (isImage(bytes, file.type)) photos.push({ name: file.name, type: file.type || "image/jpeg", bytes });
    else skipped.push(file.name);
  }
  if (photos.length) {
    navigate({ view: "scan" });
    tray.add(photos);
    setStatus(skipped.length ? `${skipped.join("、")} は PDF でも写真でもないので外しました。` : "");
    return;
  }
  setStatus(`${skipped.join("、")} はPDFでも写真でもないようです。スキャンしたPDFか、楽譜の写真を選んでください。`);
}

// The library: scores opened on this device, to open again without picking the files.
const dateFormat = new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** The files kept for a library entry, as a source to analyze; null when none were kept. */
function entrySource(entry: LibraryEntry): Source | null {
  const bytes = (f: StoredFile) => new Uint8Array(f.data);
  if (!entry.files.length) return null;
  return entry.kind === "photos"
    ? { kind: "photos", name: entry.name, photos: entry.files.map((f) => ({ name: f.name, type: f.type, bytes: bytes(f) })) }
    : { kind: "pdf", name: entry.name, bytes: bytes(entry.files[0]!) };
}

let coverJob = 0;
/** Covers being made, per score (each is tried once while the page is open). */
const coverJobs = new Map<string, Promise<string | null>>();

/** The cover of `source`: its first page upright, or as it is when it has no staves (a title page). */
async function makeCover(source: Source): Promise<string | null> {
  try {
    for await (const [, image, photo] of pagesOf(source)) {
      const page = coverPixels(image);
      // Negative indexes keep these apart from the pages of a running analysis.
      const result = await detectInWorker(-++coverJob, image, photo);
      return coverUrl(result.preview ? coverPixels(result.preview) : page);
    }
  } catch {
    // no cover: the drawn one stands in
  }
  return null;
}

/** Make the cover `key` once, then run `done` with it. */
function whenCovered(key: string, source: Source, done: (cover: string) => void) {
  if (coverJobs.has(key)) return;
  const job = makeCover(source);
  coverJobs.set(key, job);
  void job.then((cover) => cover && done(cover));
}

/** Chord names of a score in order, each change once, for the drawn cover. */
function chordNames(doc: GtsDocument | null | undefined): string[] {
  const names = (doc ? measures(doc) : []).flatMap((m) => (m.chords ?? []).map((c) => prettyChord(c.symbol)));
  return names.filter((name, i) => name !== names[i - 1]);
}

function actionButton(label: string, onClick: () => void, className = ""): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (className) button.className = className;
  button.addEventListener("click", onClick);
  return button;
}

/** One score of the list: cover (tapping it does `primary`), title, facts, tags and buttons. */
function scoreCard(card: {
  title: string;
  facts: string;
  tags: string[];
  cover: HTMLElement;
  primary: () => void;
  actions: HTMLButtonElement[];
}): HTMLLIElement {
  const li = document.createElement("li");
  card.cover.addEventListener("click", card.primary);
  const text = document.createElement("div");
  text.className = "entry-text";
  const title = document.createElement("strong");
  title.textContent = card.title;
  const facts = document.createElement("small");
  facts.textContent = card.facts;
  if (card.tags.length) {
    const tags = document.createElement("div");
    tags.className = "tags";
    for (const label of card.tags) {
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = label;
      tags.append(tag);
    }
    text.append(tags);
  }
  text.append(title, facts);
  const actions = document.createElement("div");
  actions.className = "entry-actions";
  actions.append(...card.actions);
  li.append(card.cover, text, actions);
  return li;
}

async function renderLibrary() {
  const [available, entries, usage] = await Promise.all([library.available(), library.list(), library.usage()]);
  ui.library.hidden = !available;
  ui.libraryUnavailable.hidden = available;
  ui.libraryEmpty.hidden = !available || entries.length > 0;
  ui.libraryExport.disabled = entries.length === 0;
  ui.libraryList.replaceChildren(
    ...entries.map((entry) => {
      const summary = entry.doc ? reviewSummary(entry.doc) : null;
      const pages = entry.doc?.source.pages.length;
      const title = entry.doc?.meta.title && entry.doc.meta.title !== entry.name.replace(/\.[^.]*$/, "") ? `${entry.doc.meta.title}（${entry.name}）` : entry.name;
      const facts = [
        entry.files.length === 0
          ? "ファイルなし（同じ PDF・写真を開くと戻ります）"
          : entry.kind === "photos"
            ? `写真 ${entry.files.length} 枚`
            : "PDF",
        summary ? `確認済み ${summary.reviewed} / ${summary.total} 小節` : "未読",
        ...(summary?.attention ? [`要確認 ${summary.attention}`] : []),
        dateFormat.format(entry.updated),
      ].join(" · ");
      const open = () => navigate({ view: "score", id: entry.id });
      const play = () => entry.doc && player.open(entry.doc);
      const actions: HTMLButtonElement[] = [];
      if (entry.files.length) {
        const button = actionButton("開く", open, "primary");
        button.title = pages ? `${pages} ページ` : "";
        actions.push(button);
      }
      // Something read can be played; work without its files (imported without them) still plays.
      if (entry.doc && (!entry.files.length || (summary && summary.unread < summary.total))) actions.push(actionButton("演奏ビュー", play));
      const remove = actionButton(
        "削除",
        async () => {
          if (!confirm(`${entry.name} と作業内容をこの端末から削除しますか？（保存した gts.json は消えません）`)) return;
          await library.remove(entry.id);
          void renderLibrary();
        },
        "danger",
      );
      remove.setAttribute("aria-label", `${entry.name} を端末から削除`);
      actions.push(remove);
      const source = entry.cover ? null : entrySource(entry);
      if (source) {
        whenCovered(entry.id, source, async (cover) => {
          const latest = await library.get(entry.id);
          if (latest && !latest.cover && (await library.put({ ...latest, cover }))) void renderLibrary();
        });
      }
      const li = scoreCard({
        title,
        facts,
        tags: [],
        cover: coverArt(entry.cover, entry.doc?.meta.title ?? entry.name, chordNames(entry.doc)),
        primary: entry.files.length ? open : play,
        actions,
      });
      if (entry.id === state.sha256) li.classList.add("current");
      return li;
    }),
  );
  ui.libraryNote.textContent =
    usage === null ? "" : `この端末で使っている容量: ${(usage / 1024 / 1024).toFixed(1)} MB`;
  void renderSamples();
}

/** Covers of the sample PDFs, made on this visit (the samples are part of the page, not the library). */
const sampleCovers = new Map<string, string>();

/** The sample songs, tagged as such, with the work done on them here. */
async function renderSamples() {
  const [ids, stored] = await Promise.all([samplesById(), library.all()]);
  const idOf = new Map([...ids].map(([id, s]) => [s, id]));
  ui.sampleList.replaceChildren(
    ...sampleSongs.map((song) => {
      const id = song.pdf && idOf.get(song.pdf);
      const entry = id ? stored.find((e) => e.id === id) : undefined;
      const work = entry?.doc;
      const cover = sampleCovers.get(song.label) ?? entry?.cover;
      const summary = work ? reviewSummary(work) : null;
      const open = () => id && navigate({ view: "score", id });
      const play = () => song.gts && player.open(structuredClone(song.gts));
      const actions = [
        ...(id ? [actionButton("開く", open, "primary")] : []),
        ...(song.gts ? [actionButton("演奏ビュー", play)] : []),
      ];
      if (song.pdf && !cover) {
        whenCovered(`sample:${song.label}`, { kind: "sample", name: song.pdf.file, bytes: decode(song.pdf.pdf) }, (cover) => {
          sampleCovers.set(song.label, cover);
          void renderSamples();
        });
      }
      return scoreCard({
        title: song.label,
        facts: [...song.notes, ...(summary ? [`確認済み ${summary.reviewed} / ${summary.total} 小節`] : [])].join(" · "),
        tags: ["サンプル"],
        cover: coverArt(cover, song.label, chordNames(song.gts ?? work)),
        primary: id ? open : play,
        actions,
      });
    }),
  );
}

/** Write the whole library to one file, to move it to another device. */
async function exportAll() {
  ui.libraryExport.disabled = true;
  ui.libraryMessage.textContent = "書き出しています…";
  try {
    const entries = await library.all();
    const lines = await exportLibrary(entries, { files: ui.libraryWithFiles.checked });
    const date = new Date().toISOString().slice(0, 10);
    const count = entries.filter((e) => e.kind !== "sample").length;
    ui.libraryMessage.textContent = await saveText(
      `guitarmr-library-${date}.jsonl`,
      `${lines.join("\n")}\n`,
      "application/jsonl",
      `${count} 曲を書き出しました。新しい端末でこのページを開き「取り込む」で選んでください。`,
    );
  } catch (e) {
    ui.libraryMessage.textContent = `書き出せませんでした（${(e as Error).message}）。`;
  } finally {
    ui.libraryExport.disabled = false;
  }
}

/** Take in a library export: the work on every score first, files where they came through whole. */
async function importFile(file: File) {
  ui.libraryMessage.textContent = `${file.name} を取り込んでいます…`;
  try {
    const result = await importLibrary(linesOf(file));
    let failed = 0;
    for (const incoming of result.entries) {
      if (!(await library.put(mergeEntry(await library.get(incoming.id), incoming)))) failed++;
    }
    const scores = result.entries.filter((e) => e.kind !== "sample").length;
    const parts = [`${scores} 曲を取り込みました。`];
    if (result.withoutFiles.length) {
      parts.push(`${result.withoutFiles.join("、")} は PDF・写真が壊れていたか途中で切れていたので、作業内容だけ取り込みました（同じ PDF・写真を開くと戻ります）。`);
    }
    if (result.truncated && !result.withoutFiles.length) parts.push("ファイルの最後が欠けていましたが、取り込める分はすべて取り込みました。");
    if (failed) parts.push(`${failed} 曲は端末の容量が足りず保存できませんでした。`);
    ui.libraryMessage.textContent = parts.join("");
  } catch (e) {
    ui.libraryMessage.textContent = `${file.name} を取り込めませんでした（${(e as Error).message}）。`;
  }
  void renderLibrary();
  ui.library.scrollIntoView({ block: "nearest" });
}

ui.libraryExport.addEventListener("click", () => void exportAll());
ui.libraryImport.addEventListener("change", () => {
  const file = ui.libraryImport.files?.[0];
  ui.libraryImport.value = "";
  if (file) void importFile(file);
});

/** Open the score `id`: analyze its stored files (or the built-in sample) again, then continue the stored work. */
async function openEntry(id: string) {
  opening = id;
  try {
    const entry = await library.get(id);
    const source = entry && entrySource(entry);
    if (source) {
      tray.clear();
      await analyze(source);
      return;
    }
    const sample = await sampleById(id);
    if (sample) {
      await analyze({ kind: "sample", name: sample.file, bytes: decode(sample.pdf) });
      return;
    }
    setStatus(entry ? "この楽譜のファイルが端末に残っていません。" : "この楽譜はこの端末のライブラリにありません。");
    if (route.view === "score" && route.id === id) navigate({ view: "library" }, true);
  } finally {
    if (opening === id) opening = null;
  }
}

// The screens, kept in the URL hash (router.ts).
let route: Route = parseRoute(location.hash);
/** The score being opened from its route, so the route does not open it twice. */
let opening: string | null = null;

/** Show the screen of `next`, opening its score when another one is on screen. */
function showRoute(next: Route) {
  route = next;
  for (const [view, el] of Object.entries(ui.views)) el.hidden = view !== next.view;
  const tab = next.view === "score" ? "library" : next.view;
  for (const a of ui.tabs) {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
  if (next.view === "settings") ui.settingsLink.setAttribute("aria-current", "page");
  else ui.settingsLink.removeAttribute("aria-current");
  if (next.view !== "score") editor.close();
  scrollTo({ top: 0 });
  if (next.view === "score" && next.id !== state.sha256 && next.id !== opening) void openEntry(next.id);
}

/** Go to the screen `next`; `replace` leaves no step back to the screen on show. */
function navigate(next: Route, replace = false) {
  const hash = routeHash(next);
  if (location.hash === hash) return;
  if (replace) location.replace(hash);
  else location.hash = hash;
}

/**
 * One step back, for the Android back button: close the editor or the play
 * view, else go to the parent screen. False on the score list, where the
 * app goes to the background.
 */
function back(): boolean {
  if (player.isOpen()) {
    player.close();
    return true;
  }
  if (editor.current()) {
    editor.close();
    return true;
  }
  const parent = parentRoute(route);
  if (!parent) return false;
  navigate(parent, true);
  return true;
}
(globalThis as { tky?: { back(): boolean } }).tky = { back };

addEventListener("hashchange", () => showRoute(parseRoute(location.hash)));

for (const input of [ui.file, ui.camera, ui.trayCamera, ui.trayFile]) {
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    input.value = ""; // picking the same file again still fires change
    void openFiles(files);
  });
}
ui.openGts.addEventListener("change", () => {
  const file = ui.openGts.files?.[0];
  ui.openGts.value = "";
  if (file) void openGts(file);
});
// Desktop: drop a PDF, photos (or a gts file for the open score) anywhere on the page.
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault();
  void openFiles([...(e.dataTransfer?.files ?? [])]);
});
// Tapping a measure while an editor field has focus commits that field on
// blur, which redraws the overlay under the finger: the pressed measure is
// gone by the release, so the browser sends no click. The tap still counts.
let pressed: Element | null = null;
ui.pages.addEventListener("pointerdown", (e) => {
  pressed = (e.target as Element).closest?.("[data-id]") ?? null;
});
ui.pages.addEventListener("pointerup", (e) => {
  const was = pressed;
  pressed = null;
  if (was && !was.isConnected && (e.target as Element).closest?.(".overlay")) editor.open(was.getAttribute("data-id")!);
});
ui.pages.addEventListener("click", (e) => {
  const g = (e.target as Element).closest?.("[data-id]");
  if (g) editor.open(g.getAttribute("data-id")!);
});
ui.pages.addEventListener("keydown", (e) => {
  const g = (e.target as Element).closest?.("[data-id]");
  if (g && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    editor.open(g.getAttribute("data-id")!);
  }
});
ui.nextAttention.addEventListener("click", () => {
  // The next measure marked for review after the open one, wrapping around.
  const all = measures(state.doc!);
  const from = all.findIndex((m) => m.id === state.selected);
  const order = [...all.slice(from + 1), ...all.slice(0, from + 1)];
  const next = order.find((m) => statusOf(m) === "attention");
  if (next?.id) editor.open(next.id);
});
ui.discardDraft.addEventListener("click", () => {
  dropDraft();
  ui.draftNote.hidden = true;
  editor.close();
  if (state.detected) commit(state.detected, false);
});
ui.read.addEventListener("click", () => void read());
ui.readTab.addEventListener("click", () => void read(undefined, "tab"));
ui.stop.addEventListener("click", () => readAbort?.abort());
ui.save.addEventListener("click", save);
ui.copy.addEventListener("click", copy);

/** Offer the Android app's API key dialog in the settings. */
async function setUpApiKeySettings() {
  const settings = ((await claude?.use("apiKeySettings").catch(() => null)) as ApiKeySettings | null | undefined) ?? null;
  if (!settings) return;
  ui.apiKey.hidden = false;
  ui.apiKeyOpen.addEventListener("click", () => settings.open());
}

void setUpAi();
void setUpApiKeySettings();
void renderLibrary();
showRoute(route);

/**
 * The demo page: pick a PDF, render it with pdf.js, detect every page in
 * the worker (layout layer), let Claude read chords and structure from the
 * measure images, review and correct them measure by measure, and save
 * the gts file. The PDF itself never leaves the device; only the system
 * images go to Claude, on the viewer's own claude.ai account.
 *
 * The core packages are not imported at run time: scripts/build.ts puts
 * them in a classic script before this module (their functions become
 * globals) and in the worker; the imports below are for type checking only.
 */

import { type GtsDocument, measures } from "@guitarmr/gts";
import { reviewSummary } from "@guitarmr/extract";
import { type RgbaImage, type ScannedPage, buildDocument, renderPages, sha256Hex } from "@guitarmr/layoutscan";
import * as pdfjs from "pdfjs-dist";
import { createEditor } from "./editor.ts";
import { createPlayer } from "./player.ts";
import type { DetectResult } from "./preview.ts";
import { type Sample, readPages } from "./reader.ts";
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
const claude = (globalThis as { claude?: { use(name: string): Promise<unknown> } }).claude;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const ui = {
  file: $<HTMLInputElement>("pdf-file"),
  samples: $<HTMLDivElement>("samples"),
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
  playSamples: $<HTMLElement>("play-samples"),
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
const detectInWorker = (index: number, image: RgbaImage): Promise<DetectResult> =>
  new Promise((resolve, reject) => {
    pending.set(index, (r) => (r.error ? reject(new Error(r.error)) : resolve(r)));
    worker.postMessage({ index, image }, [image.data.buffer as ArrayBuffer]);
  });

/** Everything about the score on screen. */
const state = {
  name: "",
  sha256: "",
  /** The layout-only document from detection, to start over from. */
  detected: null as GtsDocument | null,
  doc: null as GtsDocument | null,
  pages: new Map<number, PageView>(),
  selected: null as string | null,
};

let run = 0; // a newer analysis cancels the running one

function setStatus(text: string, progress: number | null = null) {
  ui.status.textContent = text;
  ui.progress.hidden = progress === null;
  if (progress !== null) ui.progress.value = progress;
}

const outputName = () => state.name.replace(/\.pdf$/i, "") + ".gts.json";
const json = () => `${JSON.stringify(state.doc, null, 2)}\n`;

// Drafts: the work in progress survives a reload, per PDF, in this browser only.
const DRAFT_PREFIX = "guitarmr.draft.";
function saveDraft() {
  try {
    if (state.doc) localStorage.setItem(DRAFT_PREFIX + state.sha256, JSON.stringify(state.doc));
  } catch {
    // storage full or blocked: drafts are a convenience only
  }
}
function loadDraft(sha256: string): GtsDocument | null {
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
  ui.json.value = json();
  ui.save.textContent = `${outputName()} を保存`;
  editor.refresh();
  if (persist) saveDraft();
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

function pageCard(result: DetectResult, preview: { blob: Blob; url: string } | null): HTMLLIElement {
  const { layout } = result;
  const li = document.createElement("li");
  li.className = "page";
  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h3");
  title.textContent = `p${result.index + 1}`;
  head.append(title);
  if (!preview || !result.preview) {
    li.classList.add("skipped");
    const note = document.createElement("p");
    note.textContent = "段が見つからないためスキップしました（歌詞だけのページなど）";
    head.append(note);
    li.append(head);
    return li;
  }
  const facts = document.createElement("dl");
  for (const [term, value] of [
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
  state.pages.clear();
  state.doc = state.detected = null;
  ui.summary.hidden = true;
  ui.pages.replaceChildren();
}

async function analyze(name: string, bytes: Uint8Array) {
  const mine = ++run;
  reset();
  state.name = name;
  setStatus(`${name} を読み込み中…`, 0);
  const scanned: ScannedPage[] = [];
  let total = 0;
  let done = 0;
  let sha256: string;
  try {
    const task = pdfjs.getDocument({ data: bytes.slice() });
    total = (await task.promise).numPages;
    await task.destroy();
    for await (const [index, image] of renderPages(pdfjs as never, bytes)) {
      if (mine !== run) return;
      setStatus(`${name}: ${index + 1} / ${total} ページ目を解析中…`, done / total);
      const result = await detectInWorker(index, image);
      if (mine !== run) return;
      let preview = null;
      if (result.preview) {
        const blob = await toJpeg(result.preview);
        preview = { blob, url: URL.createObjectURL(blob) };
      }
      ui.pages.append(pageCard(result, preview));
      if (result.layout.systems.length) scanned.push({ index, layout: result.layout });
      done++;
    }
    sha256 = await sha256Hex(bytes);
  } catch (e) {
    if (mine === run) setStatus(`${name} を処理できませんでした（${(e as Error).message}）。`);
    return;
  }
  if (mine !== run) return;
  if (scanned.length === 0) {
    setStatus(`${name}: どのページにも段（TAB譜の6本線）が見つかりませんでした。`);
    return;
  }
  state.sha256 = sha256;
  state.detected = buildDocument(name, sha256, scanned);
  const draft = loadDraft(sha256);
  ui.draftNote.hidden = !draft;
  ui.source.textContent = name;
  ui.saveNote.textContent = "";
  ui.readStatus.textContent = "";
  ui.readWarnings.hidden = true;
  ui.summary.hidden = false;
  commit(draft ?? state.detected, false);
  setStatus("");
}

// Reading with Claude (claude.ai "sample" capability).
let sample: Sample | null = null;
let readAbort: AbortController | null = null;

async function read(pages?: number[]) {
  if (!sample || !state.doc || readAbort) return;
  const todo =
    pages ??
    [...new Set(measures(state.doc).filter((m) => statusOf(m) === "unread").map((m) => m.region!.page))].sort((a, b) => a - b);
  if (!todo.length) return;
  readAbort = new AbortController();
  ui.read.disabled = true;
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
  );
  clearInterval(tick);
  readAbort = null;
  ui.read.disabled = false;
  ui.stop.hidden = true;
  const s = reviewSummary(state.doc);
  const messages: Record<string, string> = {
    cancelled: "止めました。「続きを読む」で未読のページから再開できます。",
    rate_limited: "Claude の利用上限に達しました。時間をおいて「続きを読む」を押してください。",
    not_granted: "Claude の利用が許可されませんでした。",
    upstream_error: "Claude に接続できませんでした。少し待ってからもう一度押してください。",
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

async function save() {
  if (!state.doc) return;
  const downloads = (await claude?.use("downloads")) as Downloads | null | undefined;
  if (downloads) {
    try {
      await downloads.save({ filename: outputName(), data: json() });
      ui.saveNote.textContent = "保存しました。PDFと同じ場所に置くと Quest のアプリが読み込めます。";
    } catch (e) {
      const code = (e as { code?: string }).code;
      ui.saveNote.textContent =
        code === "declined" ? "保存をキャンセルしました。" : "この画面では保存できません。「JSONをコピー」を使ってください。";
    }
    return;
  }
  if (claude) {
    ui.saveNote.textContent = "この画面では保存できません。「JSONをコピー」を使ってください。";
    return;
  }
  // Opened as a plain file outside claude.ai: an ordinary download works.
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([json()], { type: "application/json" }));
  a.download = outputName();
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
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
for (const s of scores) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sample";
  button.innerHTML = "<span></span><small></small>";
  button.querySelector("span")!.textContent = s.label;
  button.querySelector("small")!.textContent = s.note;
  button.addEventListener("click", () => player.open(structuredClone(s.gts)));
  ui.playSamples.insertBefore(button, ui.playSamples.querySelector(".file-link"));
}
ui.playOpen.addEventListener("click", () => state.doc && player.open(state.doc));
ui.playGts.addEventListener("change", () => {
  const file = ui.playGts.files?.[0];
  ui.playGts.value = "";
  if (file) void playFile(file);
});

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const samples: SampleFile[] = JSON.parse($("samples-data").textContent!);
for (const s of samples) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sample";
  button.innerHTML = "<span></span><small></small>";
  button.querySelector("span")!.textContent = s.label;
  button.querySelector("small")!.textContent = s.note;
  button.addEventListener("click", () => analyze(s.file, decode(s.pdf)));
  ui.samples.append(button);
}

/** Read a picked or dropped file; any file type is accepted, the bytes decide. */
async function openFile(file: File) {
  run++; // stop a running analysis right away
  setStatus(`${file.name} を読み込み中…`, 0);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (e) {
    // e.g. an iCloud/Drive file that is not on the device yet
    setStatus(`${file.name} を読めませんでした（${(e as Error).message}）。端末にダウンロードしてから選んでください。`);
    return;
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 1024));
  if (head.trimStart().startsWith("{") && state.doc) {
    setStatus("");
    return openGts(file);
  }
  if (head.indexOf("%PDF-") < 0) {
    setStatus(`${file.name} はPDFではないようです。スキャンしたPDFを選んでください。`);
    return;
  }
  await analyze(file.name, bytes);
}

ui.file.addEventListener("change", () => {
  const file = ui.file.files?.[0];
  ui.file.value = ""; // picking the same file again still fires change
  if (file) void openFile(file);
});
ui.openGts.addEventListener("change", () => {
  const file = ui.openGts.files?.[0];
  ui.openGts.value = "";
  if (file) void openGts(file);
});
// Desktop: drop a PDF (or a gts file for the open PDF) anywhere on the page.
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) void openFile(file);
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
ui.stop.addEventListener("click", () => readAbort?.abort());
ui.save.addEventListener("click", save);
ui.copy.addEventListener("click", copy);

void setUpAi();
// Open in a working state: the first sample, analyzed on this device.
if (samples[0]) void analyze(samples[0].file, decode(samples[0].pdf));

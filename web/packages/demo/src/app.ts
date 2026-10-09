/**
 * The demo page: pick a PDF, render it with pdf.js, detect every page in
 * the worker, show the measures over the upright page and save the gts
 * layout layer. Nothing leaves the device.
 *
 * The layoutscan core is not imported at run time: scripts/build.ts puts it
 * in a classic script before this module (its functions become globals) and
 * in the worker; the imports below are for type checking only.
 */

import type { GtsDocument } from "@guitarmr/gts";
import { type RgbaImage, type ScannedPage, buildDocument, measureSpans, renderPages, sha256Hex } from "@guitarmr/layoutscan";
import { drawOverlay } from "@guitarmr/layoutscan/overlay";
import * as pdfjs from "pdfjs-dist";
import type { DetectResult } from "./preview.ts";

/** Replaced by scripts/build.ts with the pdf.js worker on the CDN. */
const PDFJS_WORKER = "@PDFJS_WORKER@";

interface Sample {
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
  save: $<HTMLButtonElement>("save"),
  copy: $<HTMLButtonElement>("copy"),
  saveNote: $<HTMLParagraphElement>("save-note"),
  json: $<HTMLTextAreaElement>("json"),
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

let run = 0; // a newer analysis cancels the running one
let current: { name: string; json: string } | null = null;

const plural = (n: number, unit: string) => `${n} ${unit}`;

function setStatus(text: string, progress: number | null = null) {
  ui.status.textContent = text;
  ui.progress.hidden = progress === null;
  if (progress !== null) ui.progress.value = progress;
}

function pageCard(result: DetectResult): HTMLLIElement {
  const { layout, preview, scale } = result;
  const li = document.createElement("li");
  li.className = "page";
  const head = document.createElement("div");
  head.className = "page-head";
  const title = document.createElement("h3");
  title.textContent = `p${result.index + 1}`;
  head.append(title);
  if (!preview) {
    li.classList.add("skipped");
    const note = document.createElement("p");
    note.textContent = "段が見つからないためスキップしました（歌詞だけのページなど）";
    head.append(note);
    li.append(head);
    return li;
  }
  const counts = layout.systems.map((s) => measureSpans(s).length);
  const facts = document.createElement("dl");
  for (const [term, value] of [
    ["向き", layout.rotation === 0 ? "そのまま" : `${layout.rotation}° 回転`],
    ["傾き", `${layout.skew.toFixed(2)}°`],
    ["段", `${layout.systems.length}`],
    ["小節", `${counts.reduce((a, b) => a + b, 0)}（${counts.join(" + ")}）`],
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
  const canvas = document.createElement("canvas");
  canvas.width = preview.width;
  canvas.height = preview.height;
  const ctx = canvas.getContext("2d")!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(preview.data), preview.width, preview.height), 0, 0);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawOverlay(ctx, layout);
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", `p${result.index + 1}: ${layout.systems.length} 段、小節の枠つき`);
  li.append(head, canvas);
  return li;
}

async function analyze(name: string, bytes: Uint8Array) {
  const mine = ++run;
  current = null;
  ui.summary.hidden = true;
  ui.pages.replaceChildren();
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
      ui.pages.append(pageCard(result));
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
  const document_: GtsDocument = buildDocument(name, sha256, scanned);
  const json = `${JSON.stringify(document_, null, 2)}\n`;
  current = { name: name.replace(/\.pdf$/i, "") + ".gts.json", json };
  const measures = document_.sections[0]!.measures.length;
  ui.source.textContent = name;
  ui.stats.textContent = [
    plural(total, "ページ"),
    `${plural(measures, "小節")}`,
    total > scanned.length ? `${total - scanned.length} ページはスキップ` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  ui.save.textContent = `${current.name} を保存`;
  ui.json.value = json;
  ui.saveNote.textContent = "";
  ui.summary.hidden = false;
  setStatus("");
}

async function save() {
  if (!current) return;
  const downloads = (await claude?.use("downloads")) as Downloads | null | undefined;
  if (downloads) {
    try {
      await downloads.save({ filename: current.name, data: current.json });
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
  a.href = URL.createObjectURL(new Blob([current.json], { type: "application/json" }));
  a.download = current.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function copy() {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(current.json);
    ui.saveNote.textContent = "JSONをコピーしました。";
  } catch {
    const details = ui.json.closest("details");
    if (details) details.open = true;
    ui.json.focus();
    ui.json.select();
    ui.saveNote.textContent = "コピーできなかったので全体を選択しました。共有メニューからコピーしてください。";
  }
}

const decode = (b64: string): Uint8Array => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const samples: Sample[] = JSON.parse($("samples-data").textContent!);
for (const sample of samples) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sample";
  button.innerHTML = "<span></span><small></small>";
  button.querySelector("span")!.textContent = sample.label;
  button.querySelector("small")!.textContent = sample.note;
  button.addEventListener("click", () => analyze(sample.file, decode(sample.pdf)));
  ui.samples.append(button);
}

ui.file.addEventListener("change", async () => {
  const file = ui.file.files?.[0];
  if (file) await analyze(file.name, new Uint8Array(await file.arrayBuffer()));
});
ui.save.addEventListener("click", save);
ui.copy.addEventListener("click", copy);

// Open in a working state: the first sample, analyzed on this device.
if (samples[0]) void analyze(samples[0].file, decode(samples[0].pdf));

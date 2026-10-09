/**
 * Shared setup for the end-to-end tests: the built single-file page
 * (packages/demo/dist) is served from a local URL, pdf.js requests to the
 * CDN are answered from the local pdfjs-dist package, web fonts are
 * blocked, and the claude.ai runtime can be replaced by a fake that
 * answers like Claude from a gts file. Nothing reaches the network.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContextOptions, type Page, chromium } from "playwright-core";

export const PAGE_FILE = fileURLToPath(new URL("../../demo/dist/layoutscan-demo.html", import.meta.url));
const PDFJS_DIR = dirname(fileURLToPath(import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs")));
export const EXAMPLES = new URL("../../../../schemas/examples/", import.meta.url);

/** Screenshots for people to look at (uploaded by CI); not compared. */
export const ARTIFACTS = process.env.E2E_ARTIFACTS ?? fileURLToPath(new URL("../.artifacts/", import.meta.url));
mkdirSync(ARTIFACTS, { recursive: true });

export const PHONE = { width: 390, height: 844 };
export const TABLET = { width: 1180, height: 820 };

export async function launch(): Promise<Browser> {
  if (!existsSync(PAGE_FILE)) throw new Error(`${PAGE_FILE} is missing: run "pnpm --filter @guitarmr/demo build" first`);
  // CHROMIUM_PATH: use an installed Chromium instead of Playwright's own download.
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

export interface OpenOptions extends BrowserContextOptions {
  /** Install a fake claude.ai runtime answering from this gts document. */
  claudeFrom?: unknown;
}

export interface OpenPage {
  page: Page;
  /** Uncaught errors in the page; tests assert it stays empty. */
  errors: string[];
}

export async function openPage(browser: Browser, options: OpenOptions = {}): Promise<OpenPage> {
  const { claudeFrom, ...contextOptions } = options;
  const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2, ...contextOptions });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://cdn.jsdelivr.net/**", (route) =>
    route.fulfill({
      body: readFileSync(`${PDFJS_DIR}/${route.request().url().split("/").pop()}`),
      contentType: "text/javascript",
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (route) => route.abort());
  // The Artifact host adds the document head; the page body is served as is
  // with the viewport meta the host would add.
  const html = readFileSync(PAGE_FILE, "utf8").replace(
    "<title>",
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>',
  );
  await page.route("http://localhost/", (route) => route.fulfill({ body: html, contentType: "text/html; charset=utf-8" }));
  if (claudeFrom) await page.addInitScript(fakeClaude, JSON.stringify(claudeFrom));
  await page.goto("http://localhost/");
  return { page, errors };
}

/**
 * The claude.ai runtime as seen by the page: `sample` answers the reading
 * prompt with the measures it lists, taken from the given gts document
 * (m3 comes back unsure, with a note), and `downloads` keeps saved files.
 * Runs inside the page, so it must be self-contained.
 */
function fakeClaude(truthJson: string) {
  const truth = JSON.parse(truthJson);
  const all = truth.sections.flatMap((s: { label?: string; measures: Record<string, unknown>[] }) =>
    s.measures.map((m, i) => ({ m, label: i === 0 ? s.label : undefined })),
  );
  const w = window as unknown as Record<string, unknown>;
  const calls: { ids: string[]; images: number; header: boolean }[] = [];
  const saved: { filename: string; data: string }[] = [];
  w.__calls = calls;
  w.__saved = saved;
  const sample = {
    limits: async () => ({ maxPromptBytes: 100000, images: { maxCount: 5, maxInputBytes: 5e6, mediaTypes: ["image/jpeg"] } }),
    json: async (prompt: string, opts: { images?: Blob[] }) => {
      const ids = [...prompt.matchAll(/measures ([m\d, ]+) \(left/g)].flatMap((x) => x[1]!.split(", "));
      calls.push({ ids, images: opts.images?.length ?? 0, header: prompt.includes('"header"') });
      await new Promise((r) => setTimeout(r, 100));
      const measures = all
        .filter(({ m }: { m: { id: string } }) => ids.includes(m.id))
        .map(({ m, label }: { m: Record<string, unknown>; label?: string }) => {
          const { id, chords = [], barStart, barEnd, repeatTimes, volta, navigation, simile } = m;
          const out: Record<string, unknown> = { id, chords, barStart, barEnd, repeatTimes, volta, navigation, simile, section: label, confidence: 0.92 };
          if (id === "m3") Object.assign(out, { confidence: 0.4, note: "コードがかすれている" });
          return JSON.parse(JSON.stringify(out));
        });
      const { title, key, capo, tempo, timeSignature } = truth.meta;
      return { ...(calls.length === 1 ? { header: { title, key, capo, tempo, timeSignature } } : {}), measures };
    },
  };
  const downloads = {
    save: async (file: { filename: string; data: string }) => {
      saved.push(file);
      return { status: "saved" };
    },
  };
  w.claude = { use: async (name: string) => (name === "sample" ? sample : name === "downloads" ? downloads : null) };
}

export const loadExample = (name: string): unknown => JSON.parse(readFileSync(new URL(name, EXAMPLES), "utf8"));

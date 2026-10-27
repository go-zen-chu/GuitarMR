/** Files in and out: dropping, broken files, reopening a saved gts, saving, copying, old drafts, blocked storage. */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { validate } from "@guitarmr/gts/validate";
import { generatePdf, writePdf } from "@guitarmr/samples";
import type { Browser } from "playwright-core";
import { analyzed, dropFiles, launch, loadExample, openPage } from "./helpers.ts";

type Doc = { source: { sha256: string }; sections: { measures: { id: string; review?: { status: string } }[] }[] };

describe("files in and out", { timeout: 300_000 }, () => {
  let browser: Browser;
  let dir: string;
  let song: Uint8Array;
  let sakuraSha: string;
  before(async () => {
    browser = await launch();
    dir = mkdtempSync(join(tmpdir(), "gts-e2e-"));
    song = await generatePdf("twinkle-twinkle");
    writeFileSync(join(dir, "song.pdf"), song);
    writeFileSync(join(dir, "other.pdf"), await generatePdf("sakura-sakura"));
    // The built-in sample the page opens with is the same deterministic PDF.
    sakuraSha = createHash("sha256").update(await generatePdf("sakura-sakura")).digest("hex");
    writeFileSync(join(dir, "broken.pdf"), "%PDF-1.4\nthis is not really a PDF\n");
    const blank = { width: 600, height: 850, data: new Uint8ClampedArray(600 * 850 * 4).fill(255) };
    writeFileSync(join(dir, "lyrics.pdf"), await writePdf([blank]));
    writeFileSync(join(dir, "not-a-score.gts.json"), JSON.stringify({ hello: "world" }));
  });
  after(() => browser?.close());

  it("If a PDF is dropped on the page it should be analyzed like a picked one", async () => {
    const { page, errors } = await openPage(browser);
    await analyzed(page, "sakura-sakura.pdf");
    await dropFiles(page, [{ name: "dropped.pdf", type: "application/pdf", bytes: song }]);
    await analyzed(page, "dropped.pdf");
    assert.match((await page.locator("#summary-stats").textContent())!, /1 ページ · 12 小節/);
    assert.deepEqual(errors, []);
  });

  it("If several PDFs are picked the first should be analyzed", async () => {
    const { page, errors } = await openPage(browser);
    await analyzed(page, "sakura-sakura.pdf");
    await page.setInputFiles("#pdf-file", [join(dir, "song.pdf"), join(dir, "other.pdf")]);
    await analyzed(page, "song.pdf");
    assert.deepEqual(errors, []);
  });

  it("If a PDF is broken or has no TAB it should say so and keep the page usable", async () => {
    const { page, errors } = await openPage(browser);
    await analyzed(page, "sakura-sakura.pdf");
    await page.setInputFiles("#pdf-file", join(dir, "broken.pdf"));
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("broken.pdf を処理できませんでした"));
    await page.setInputFiles("#pdf-file", join(dir, "lyrics.pdf"));
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("どのページにも段（TAB譜の6本線）が見つかりませんでした"));
    // The skipped page is still listed, and the next PDF opens normally.
    assert.match((await page.locator(".page.skipped").textContent())!, /スキップしました/);
    await page.setInputFiles("#pdf-file", join(dir, "song.pdf"));
    await analyzed(page, "song.pdf");
    assert.deepEqual(errors, []);
  });

  it("If a saved gts file is opened again it should continue only on its own PDF", async () => {
    const { page, errors } = await openPage(browser);
    await analyzed(page, "sakura-sakura.pdf");
    // A gts of the open PDF, with one measure reviewed.
    const doc = structuredClone(loadExample("sakura-sakura.gts.json")) as Doc;
    doc.source.sha256 = sakuraSha;
    doc.sections[0]!.measures[0]!.review = { status: "reviewed" };
    writeFileSync(join(dir, "sakura-sakura.gts.json"), JSON.stringify(doc));
    await page.setInputFiles("#gts-file", join(dir, "sakura-sakura.gts.json"));
    await page.waitForFunction(() => document.querySelector("#save-note")?.textContent === "sakura-sakura.gts.json を開きました。");
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    assert.match((await page.locator("#summary-stats").textContent())!, /layout, structure, chords, tab, lyrics/);

    // Through the main button too; another PDF's gts is refused, and so is a file that is not gts.
    const other = { ...doc, source: { ...doc.source, sha256: "0".repeat(64) } };
    writeFileSync(join(dir, "other.gts.json"), JSON.stringify(other));
    await page.setInputFiles("#pdf-file", join(dir, "other.gts.json"));
    await page.waitForFunction(() => document.querySelector("#save-note")?.textContent?.includes("いま開いている PDF の gts ではありません"));
    await page.setInputFiles("#gts-file", join(dir, "not-a-score.gts.json"));
    await page.waitForFunction(() => document.querySelector("#save-note")?.textContent?.includes("を開けませんでした（gts ではありません）"));
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    assert.deepEqual(errors, []);
  });

  it("If the score is saved outside claude.ai it should download as a valid gts file", async () => {
    const { page, errors } = await openPage(browser);
    await analyzed(page, "sakura-sakura.pdf");
    const download = page.waitForEvent("download");
    await page.click("#save");
    const file = join(dir, (await download).suggestedFilename());
    await (await download).saveAs(file);
    assert.match(file, /sakura-sakura\.gts\.json$/);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(validate(doc), { valid: true, errors: [] });
    assert.equal(doc.source.sha256, sakuraSha);
    assert.deepEqual(errors, []);
  });

  it("If the viewer declines the save dialog it should say it was cancelled", async () => {
    const { page, errors } = await openPage(browser, { claude: { truth: loadExample("sakura-sakura.gts.json"), save: "decline" } });
    await analyzed(page, "sakura-sakura.pdf");
    await page.click("#save");
    await page.waitForFunction(() => document.querySelector("#save-note")?.textContent === "保存をキャンセルしました。");
    assert.deepEqual(errors, []);
  });

  it("If the JSON is copied it should be on the clipboard, or selected when copying is refused", async () => {
    const granted = await openPage(browser, { permissions: ["clipboard-read", "clipboard-write"] });
    await analyzed(granted.page, "sakura-sakura.pdf");
    await granted.page.click("#copy");
    await granted.page.waitForFunction(() => document.querySelector("#save-note")?.textContent === "JSONをコピーしました。");
    const copied = JSON.parse(await granted.page.evaluate(() => navigator.clipboard.readText()));
    assert.equal(copied.source.sha256, sakuraSha);

    const refused = await openPage(browser, {
      setup: (page) =>
        page.addInitScript(() => {
          Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) } });
        }),
    });
    await analyzed(refused.page, "sakura-sakura.pdf");
    await refused.page.click("#copy");
    await refused.page.waitForFunction(() => document.querySelector("#save-note")?.textContent?.includes("全体を選択しました"));
    assert.equal(await refused.page.locator("#json").isVisible(), true);
    const selected = await refused.page.evaluate(() => {
      const json = document.querySelector<HTMLTextAreaElement>("#json")!;
      return json.selectionEnd - json.selectionStart === json.value.length && document.activeElement === json;
    });
    assert.equal(selected, true);
    assert.deepEqual([...granted.errors, ...refused.errors], []);
  });

  it("If a gts file is opened in the play view it should play without its PDF, and a wrong file be refused", async () => {
    const { page, errors } = await openPage(browser);
    await analyzed(page, "sakura-sakura.pdf");
    await page.setInputFiles("#play-gts", join(dir, "not-a-score.gts.json"));
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("演奏ビューで開けませんでした"));
    writeFileSync(join(dir, "twinkle.gts.json"), JSON.stringify(loadExample("twinkle-twinkle.gts.json")));
    await page.setInputFiles("#play-gts", join(dir, "twinkle.gts.json"));
    await page.waitForSelector("#player:not([hidden])");
    assert.match((await page.locator("#player-title").textContent())!, /Twinkle/);
    await page.click("#player-close");
    // The score being worked on opens in the play view too.
    await page.click("#play-open");
    await page.waitForSelector("#player:not([hidden])");
    assert.equal(await page.locator("#player-bars .bar").count() > 0, true);
    assert.deepEqual(errors, []);
  });

  it("If a draft from an earlier version is in localStorage it should be moved to the library", async () => {
    const doc = structuredClone(loadExample("sakura-sakura.gts.json")) as Doc;
    doc.source.sha256 = sakuraSha;
    doc.sections[0]!.measures[1]!.review = { status: "reviewed" };
    const { page, errors } = await openPage(browser, {
      setup: (p) =>
        p.addInitScript(
          ([key, value]) => {
            // Only before the first load: the moved draft must not come back from here.
            if (!sessionStorage.getItem("seeded")) {
              localStorage.setItem(key!, value!);
              sessionStorage.setItem("seeded", "1");
            }
          },
          [`guitarmr.draft.${sakuraSha}`, JSON.stringify(doc)],
        ),
    });
    await analyzed(page, "sakura-sakura.pdf");
    assert.equal(await page.locator("#draft-note").isVisible(), true);
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    await page.waitForFunction((key) => localStorage.getItem(key) === null, `guitarmr.draft.${sakuraSha}`);
    await page.reload();
    await analyzed(page, "sakura-sakura.pdf");
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    assert.deepEqual(errors, []);
  });

  it("If the browser blocks storage the page should still work and say the work is not kept", async () => {
    const { page, errors } = await openPage(browser, {
      setup: (p) =>
        p.addInitScript(() => {
          Object.defineProperty(window, "indexedDB", {
            get() {
              throw new DOMException("blocked", "SecurityError");
            },
          });
        }),
    });
    await analyzed(page, "sakura-sakura.pdf");
    assert.equal(await page.locator("#library").isVisible(), false);
    await page.setInputFiles("#pdf-file", join(dir, "song.pdf"));
    await analyzed(page, "song.pdf");
    assert.match((await page.locator("#save-note").textContent())!, /端末に保存できません/);
    await page.locator('[data-id="m1"]').click();
    await page.click("#sheet-ok");
    await page.click("#sheet-close");
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    assert.deepEqual(errors, []);
  });
});

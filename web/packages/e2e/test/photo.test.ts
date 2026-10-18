/** Photos as input and the library on the device: correction, page order, reopening. */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { validate } from "@guitarmr/gts/validate";
import { encodeJpeg, generatePdf, generatePhotos } from "@guitarmr/samples";
import type { Browser } from "playwright-core";
import { ARTIFACTS, PHONE, launch, openPage } from "./helpers.ts";

describe("photos and the library", { timeout: 300_000 }, () => {
  let browser: Browser;
  let dir: string;
  before(async () => {
    browser = await launch();
    dir = mkdtempSync(join(tmpdir(), "gts-e2e-"));
    // Phone photos of the two pages on a desk; the second one upside down.
    (await generatePhotos("sakura-sakura")).forEach((jpeg, i) => writeFileSync(join(dir, `IMG_000${i + 1}.jpg`), jpeg));
    writeFileSync(join(dir, "song.pdf"), await generatePdf("twinkle-twinkle"));
    // A photo of the desk with no score on it.
    const desk = new Uint8ClampedArray(900 * 1200 * 4).map((_, i) => (i % 4 === 3 ? 255 : [96, 74, 56][i % 4]!));
    writeFileSync(join(dir, "IMG_desk.jpg"), await encodeJpeg({ width: 900, height: 1200, data: desk }));
    writeFileSync(join(dir, "notes.txt"), "not a library export");
  });
  after(() => browser?.close());

  it("If pages are photographed one by one they should be cut out, corrected and analyzed as one score", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await page.setInputFiles("#camera", join(dir, "IMG_0001.jpg"));
    await page.waitForSelector("#tray:not([hidden])");
    await page.setInputFiles("#tray-camera", join(dir, "IMG_0002.jpg"));
    // The photo is read asynchronously before it joins the tray.
    await page.waitForFunction(() => document.querySelectorAll("#tray-list li").length === 2);
    assert.equal(await page.locator("#tray-go").textContent(), "この 2 枚で解析する");
    await page.screenshot({ path: `${ARTIFACTS}/photo-tray.png` });

    await page.click("#tray-go");
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "IMG_0001.jpg", null, {
      timeout: 120_000,
    });
    assert.equal(await page.locator("#tray").isVisible(), false);
    assert.match((await page.locator("#summary-stats").textContent())!, /2 ページ · 15 小節/);
    const heads = await page.locator(".page-head").allTextContents();
    assert.match(heads[0]!, /切り出して補正.*そのまま/);
    assert.match(heads[1]!, /切り出して補正.*180° 回転/);
    assert.equal(await page.locator(".original").count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), PHONE.width);

    const doc = JSON.parse(await page.locator("#json").inputValue());
    assert.deepEqual(validate(doc), { valid: true, errors: [] });
    assert.equal(doc.source.file, "IMG_0001.jpg");
    assert.equal(await page.locator("#save").textContent(), "IMG_0001.gts.json を保存");
    assert.deepEqual(
      doc.source.pages.map((p: { file: string; rotation: number }) => [p.file, p.rotation]),
      [
        ["IMG_0001.jpg", 0],
        ["IMG_0002.jpg", 180],
      ],
    );
    // The sheet outline as found in the photo (see PHOTO_CORNERS in @guitarmr/samples).
    const [tl] = doc.source.pages[0].paper;
    assert.ok(Math.abs(tl[0] - 0.2278) < 0.01 && Math.abs(tl[1] - 0.2491) < 0.01, `${tl}`);
    await page.locator(".original summary").first().click();
    await page.locator(".original").first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${ARTIFACTS}/photo-corrected.png`, fullPage: true });
    assert.deepEqual(errors, []);
  });

  it("If photos are picked out of order they should be put in page order before analysis", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await page.setInputFiles("#pdf-file", [join(dir, "IMG_0002.jpg"), join(dir, "IMG_0001.jpg")]);
    await page.waitForSelector("#tray:not([hidden])");
    await page.click('[aria-label="p2 を前へ"]');
    assert.deepEqual(
      await page.locator("#tray-list img").evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).alt)),
      ["p1: IMG_0001.jpg", "p2: IMG_0002.jpg"],
    );
    await page.click('[aria-label="p2 を外す"]');
    await page.click("#tray-go");
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "IMG_0001.jpg", null, {
      timeout: 120_000,
    });
    assert.match((await page.locator("#summary-stats").textContent())!, /1 ページ · 8 小節/);
    assert.deepEqual(errors, []);
  });

  it("If a score is opened again from the library it should come back from the device with the work on it", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.equal(await page.locator("#library-empty").isVisible(), true); // the built-in sample is not listed
    await page.setInputFiles("#pdf-file", join(dir, "song.pdf"));
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    await page.waitForSelector("#library-list li");
    assert.match((await page.locator("#library-list li").textContent())!, /song\.pdf.*PDF · 確認済み 0 \/ 12 小節/);

    // Review one measure, then come back later.
    await page.locator('[data-id="m1"]').click();
    await page.waitForSelector("#sheet:not([hidden])");
    await page.fill("#f-chords", "C");
    await page.click("#sheet-ok");
    await page.click("#sheet-close");
    await page.waitForFunction(() => document.querySelector("#library-list li")?.textContent?.includes("確認済み 1 / 12"));

    await page.reload();
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.equal(await page.locator("#summary-source").textContent(), "sakura-sakura.pdf");
    await page.locator("#library-list li", { hasText: "song.pdf" }).getByRole("button", { name: "開く" }).click();
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    assert.equal(await page.locator("#draft-note").isVisible(), true);
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    await page.screenshot({ path: `${ARTIFACTS}/library.png` });

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "song.pdf を端末から削除" }).click();
    await page.waitForSelector("#library-empty:not([hidden])");
    assert.equal(await page.locator("#library-list li").count(), 0);
    assert.deepEqual(errors, []);
  });

  it("If the library is moved to another device the work should arrive first and survive damaged photos", async () => {
    // The old device: a PDF with a reviewed measure, and two photos.
    const old = await openPage(browser);
    await old.page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await old.page.setInputFiles("#pdf-file", join(dir, "song.pdf"));
    await old.page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    await old.page.locator('[data-id="m2"]').click();
    await old.page.click("#sheet-ok");
    await old.page.click("#sheet-close");
    await old.page.setInputFiles("#pdf-file", [join(dir, "IMG_0001.jpg"), join(dir, "IMG_0002.jpg")]);
    await old.page.click("#tray-go");
    await old.page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "IMG_0001.jpg", null, {
      timeout: 120_000,
    });
    await old.page.waitForFunction(() => document.querySelectorAll("#library-list li").length === 2);
    await old.page.locator(".move summary").click();
    const download = old.page.waitForEvent("download");
    await old.page.click("#library-export");
    const file = join(dir, (await download).suggestedFilename());
    await (await download).saveAs(file);
    assert.match(file, /guitarmr-library-\d{4}-\d{2}-\d{2}\.jsonl$/);
    await old.page.screenshot({ path: `${ARTIFACTS}/library-move.png` });

    // Damage the photos' data (the PDF's survives), as if the file broke on the way.
    const lines = readFileSync(file, "utf8").trimEnd().split("\n");
    const records = lines.map((l) => JSON.parse(l));
    const photos = records.find((r) => r.type === "entry" && r.entry.kind === "photos").entry.id;
    const damaged = lines.map((l, i) => (records[i].type === "chunk" && records[i].entry === photos ? l.slice(0, 80) : l));
    writeFileSync(join(dir, "damaged.jsonl"), damaged.join("\n"));

    // The new device: nothing there yet; take the export in.
    const fresh = await openPage(browser);
    await fresh.page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.equal(await fresh.page.locator("#library-empty").isVisible(), true);
    await fresh.page.locator(".move summary").click();
    await fresh.page.setInputFiles("#library-import", join(dir, "damaged.jsonl"));
    await fresh.page.waitForFunction(() => document.querySelector("#library-message")?.textContent?.includes("取り込みました"));
    assert.match((await fresh.page.locator("#library-message").textContent())!, /2 曲を取り込みました。IMG_0001\.jpg は PDF・写真が壊れていた/);
    const items = await fresh.page.locator("#library-list li").allTextContents();
    assert.equal(items.length, 2);
    assert.match(items.find((t) => t.includes("IMG_0001"))!, /ファイルなし/);
    assert.match(items.find((t) => t.includes("song.pdf"))!, /PDF · 確認済み 1 \/ 12/);
    // The photos' work still plays without them; the PDF opens with its work.
    await fresh.page.locator("#library-list li", { hasText: "IMG_0001" }).getByRole("button", { name: "演奏ビュー" }).click();
    await fresh.page.waitForSelector("#player:not([hidden])");
    await fresh.page.click("#player-close");
    await fresh.page.locator("#library-list li", { hasText: "song.pdf" }).getByRole("button", { name: "開く" }).click();
    await fresh.page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    assert.match((await fresh.page.locator("#review-summary").textContent())!, /確認済み 1/);
    // Opening the same photos again brings their files back under the imported work.
    await fresh.page.setInputFiles("#pdf-file", [join(dir, "IMG_0001.jpg"), join(dir, "IMG_0002.jpg")]);
    await fresh.page.click("#tray-go");
    await fresh.page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "IMG_0001.jpg", null, {
      timeout: 120_000,
    });
    await fresh.page.waitForFunction(() => [...document.querySelectorAll("#library-list li")].some((li) => li.textContent?.includes("写真 2 枚")));
    assert.deepEqual([...old.errors, ...fresh.errors], []);
  });

  it("If a photo has no score on it it should say what to retake", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await page.setInputFiles("#camera", join(dir, "IMG_desk.jpg"));
    await page.click("#tray-go");
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("どの写真にも段"), null, { timeout: 120_000 });
    assert.match((await page.locator("#status").textContent())!, /紙全体が入るように/);
    assert.match((await page.locator(".page.skipped").textContent())!, /6本線が写っているか/);
    // The photo is shown as it was taken (no sheet found), for checking.
    assert.match((await page.locator(".original summary").textContent())!, /用紙が見つからなかった/);
    // Nothing is kept for a photo without a score.
    assert.equal(await page.locator("#library-list li").count(), 0);
    assert.deepEqual(errors, []);
  });

  it("If only the work is moved it should arrive without files, which come back when the PDF is opened", async () => {
    const old = await openPage(browser);
    await old.page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await old.page.setInputFiles("#pdf-file", join(dir, "song.pdf"));
    await old.page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    await old.page.locator('[data-id="m3"]').click();
    await old.page.click("#sheet-ok");
    await old.page.click("#sheet-close");
    await old.page.waitForFunction(() => document.querySelector("#library-list li")?.textContent?.includes("確認済み 1"));
    await old.page.locator(".move summary").click();
    await old.page.uncheck("#library-with-files");
    const download = old.page.waitForEvent("download");
    await old.page.click("#library-export");
    const file = join(dir, "work-only.jsonl");
    await (await download).saveAs(file);
    const records = readFileSync(file, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(
      records.map((r) => r.type ?? "header"),
      ["header", "entry", "entry", "end"], // the score and the built-in sample's work
    );

    const fresh = await openPage(browser);
    await fresh.page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await fresh.page.locator(".move summary").click();
    // Something else is refused, and taking the same export twice adds nothing.
    await fresh.page.setInputFiles("#library-import", join(dir, "notes.txt"));
    await fresh.page.waitForFunction(() => document.querySelector("#library-message")?.textContent?.includes("ライブラリの書き出しファイルではありません"));
    for (let i = 0; i < 2; i++) {
      await fresh.page.setInputFiles("#library-import", file);
      await fresh.page.waitForFunction(() => document.querySelector("#library-message")?.textContent === "1 曲を取り込みました。");
      await fresh.page.evaluate(() => (document.querySelector("#library-message")!.textContent = ""));
    }
    assert.equal(await fresh.page.locator("#library-list li").count(), 1);
    assert.match((await fresh.page.locator("#library-list li").textContent())!, /ファイルなし.*確認済み 1 \/ 12/);
    await fresh.page.setInputFiles("#pdf-file", join(dir, "song.pdf"));
    await fresh.page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    assert.match((await fresh.page.locator("#review-summary").textContent())!, /確認済み 1/);
    await fresh.page.waitForFunction(() => document.querySelector("#library-list li")?.textContent?.includes("PDF · 確認済み 1 / 12"));
    assert.deepEqual([...old.errors, ...fresh.errors], []);
  });
});

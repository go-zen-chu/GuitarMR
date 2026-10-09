/** Opening a PDF: detection in the browser worker, file picking, page layout. */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { generatePdf } from "@guitarmr/samples";
import type { Browser } from "playwright-core";
import { ARTIFACTS, PHONE, launch, openPage } from "./helpers.ts";

describe("detecting measures on the phone page", { timeout: 180_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  it("If the page opens it should analyze the built-in sample on the device", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.match((await page.locator("#summary-stats").textContent())!, /2 ページ · 15 小節/);
    const heads = await page.locator(".page-head").allTextContents();
    assert.match(heads[0]!, /そのまま/);
    assert.match(heads[1]!, /180° 回転/);
    // Nothing wider than the phone.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), PHONE.width);
    await page.screenshot({ path: `${ARTIFACTS}/detect-phone.png` });
    assert.deepEqual(errors, []);
  });

  it("If a sideways scan is picked it should be turned upright", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await page.locator("#samples .sample", { hasText: "きらきら星" }).click();
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "twinkle-twinkle.pdf", null, {
      timeout: 120_000,
    });
    assert.match((await page.locator("#summary-stats").textContent())!, /1 ページ · 12 小節/);
    assert.match((await page.locator(".page-head").first().textContent())!, /90° 回転/);
    assert.deepEqual(errors, []);
  });

  it("If files are picked with the button only PDFs should be analyzed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gts-e2e-"));
    writeFileSync(join(dir, "song.pdf"), await generatePdf("twinkle-twinkle"));
    writeFileSync(join(dir, "note.txt"), "not a score");
    const { page, errors } = await openPage(browser, { hasTouch: true, isMobile: true });
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    const box = (await page.locator(".file-button").boundingBox())!;
    const pick = async (file: string) => {
      const chooser = page.waitForEvent("filechooser");
      // Tap near the edge: the whole button must open the picker.
      await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2);
      await (await chooser).setFiles(file);
    };
    await pick(join(dir, "note.txt"));
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("PDFではない"));
    await pick(join(dir, "song.pdf"));
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    assert.match((await page.locator("#summary-stats").textContent())!, /12 小節/);
    assert.deepEqual(errors, []);
  });
});

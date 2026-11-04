/** Opening a PDF: detection in the browser worker, file picking, page layout. */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { generatePdf } from "@guitarmr/samples";
import type { Browser } from "playwright-core";
import { ARTIFACTS, PHONE, TABLET, launch, openPage, openSample, show } from "./helpers.ts";

describe("detecting measures on the phone page", { timeout: 180_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  it("If the page opens it should show the score list first, with scanning in its own tab", async () => {
    const { page, errors } = await openPage(browser);
    assert.equal(await page.locator("#view-library").isVisible(), true);
    assert.equal(await page.locator("#view-scan").isVisible(), false);
    assert.equal(await page.locator('.tabs [data-tab="library"]').getAttribute("aria-current"), "page");
    assert.equal(await page.locator("#library-empty").isVisible(), true);
    assert.equal(await page.title(), "tky");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), PHONE.width);
    await page.screenshot({ path: `${ARTIFACTS}/library-first.png` });
    await page.locator("#library-empty a").click();
    await page.waitForSelector("#view-scan:not([hidden])");
    assert.equal(await page.locator('.tabs [data-tab="scan"]').getAttribute("aria-current"), "page");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), PHONE.width);
    await page.screenshot({ path: `${ARTIFACTS}/scan.png` });
    assert.deepEqual(errors, []);
  });

  it("If a sample is scanned it should be analyzed on the device and its score opened", async () => {
    const { page, errors } = await openPage(browser);
    await openSample(page);
    assert.equal(await page.evaluate(() => location.hash.startsWith("#/score/")), true);
    assert.equal(await page.locator('.tabs [data-tab="library"]').getAttribute("aria-current"), "page");
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
    await openSample(page, "twinkle-twinkle.pdf");
    assert.match((await page.locator("#summary-stats").textContent())!, /1 ページ · 12 小節/);
    assert.match((await page.locator(".page-head").first().textContent())!, /90° 回転/);
    assert.deepEqual(errors, []);
  });

  it("If files are picked with the button only PDFs and photos should be taken", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gts-e2e-"));
    writeFileSync(join(dir, "song.pdf"), await generatePdf("twinkle-twinkle"));
    writeFileSync(join(dir, "note.txt"), "not a score");
    const { page, errors } = await openPage(browser, { hasTouch: true, isMobile: true });
    await show(page, "scan");
    const pick = async (file: string) => {
      // Measured each time: the status line above moves the button once it shows.
      const box = (await page.locator(".file-button", { has: page.locator("#pdf-file") }).boundingBox())!;
      const chooser = page.waitForEvent("filechooser");
      // Tap near the edge: the whole button must open the picker.
      await page.touchscreen.tap(box.x + box.width * 0.85, box.y + box.height / 2);
      await (await chooser).setFiles(file);
    };
    await pick(join(dir, "note.txt"));
    await page.waitForFunction(() => document.querySelector("#status")?.textContent?.includes("PDFでも写真でもない"));
    await pick(join(dir, "song.pdf"));
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    await page.waitForSelector("#view-score:not([hidden])");
    assert.match((await page.locator("#summary-stats").textContent())!, /12 小節/);
    assert.deepEqual(errors, []);
  });

  it("If the page opens on a tablet the score should fill the column without overflowing", async () => {
    const { page, errors } = await openPage(browser, { viewport: TABLET });
    await openSample(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), TABLET.width);
    // The overlay sits exactly on the page image.
    const [image, overlay] = await Promise.all([page.locator(".figure img").first().boundingBox(), page.locator(".figure .overlay").first().boundingBox()]);
    assert.deepEqual(
      [image!.width, image!.height].map(Math.round),
      [overlay!.width, overlay!.height].map(Math.round),
    );
    await page.screenshot({ path: `${ARTIFACTS}/detect-tablet.png` });
    assert.deepEqual(errors, []);
  });
});

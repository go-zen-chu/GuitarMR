/** A score scanned once opens again from its stored scan; clearing the cache or scanning again scans its files anew. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { launch, openPage, openSample, show } from "./helpers.ts";

/** Keep every text the status line shows, from the page's first moment. */
const recordStatuses = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __statuses: string[] }).__statuses = seen;
    addEventListener("DOMContentLoaded", () => {
      const status = document.getElementById("status")!;
      new MutationObserver(() => seen.push(status.textContent ?? "")).observe(status, { childList: true, characterData: true, subtree: true });
    });
  });

/** Whether a page was analyzed since the page loaded or `forget` was last called. */
const scannedSince = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as { __statuses: string[] }).__statuses)).some((t) => t.includes("ページ目を解析中"));
const forget = (page: Page) => page.evaluate(() => void ((window as unknown as { __statuses: string[] }).__statuses.length = 0));
const docJson = (page: Page) => page.locator("#json").inputValue();

describe("the scan cache", { timeout: 300_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  it("If a scanned score is opened again it should come from the stored scan, and scan again once the cache is cleared", async () => {
    const { page, errors } = await openPage(browser, { setup: recordStatuses });
    await openSample(page);
    assert.equal(await scannedSince(page), true);
    const first = await docJson(page);

    await page.reload();
    await openSample(page);
    assert.equal(await scannedSince(page), false);
    assert.equal(await docJson(page), first);
    assert.equal(await page.locator("#pages .figure img").count(), 2);
    assert.ok(await page.locator('[data-id="m1"]').isVisible());

    await show(page, "settings");
    await page.click("#clear-scans");
    await page.waitForFunction(() => document.getElementById("clear-scans-note")?.textContent?.startsWith("1 曲のキャッシュを消しました"));
    await page.click("#clear-scans");
    await page.waitForFunction(() => document.getElementById("clear-scans-note")?.textContent === "消すキャッシュはありませんでした。");
    // The score on screen stays as it is; a new visit opens it from the files.
    await page.reload();
    await openSample(page);
    assert.equal(await scannedSince(page), true);
    assert.equal(await docJson(page), first);
    assert.deepEqual(errors, []);
  });

  it("If the score is scanned again its files should be analyzed anew and the work on it kept", async () => {
    const { page, errors } = await openPage(browser, { setup: recordStatuses });
    await openSample(page);
    await page.locator('[data-id="m1"]').click();
    await page.fill("#f-chords", "Am");
    await page.press("#f-chords", "Enter");
    await page.click("#sheet-close");
    const edited = await docJson(page);
    await forget(page);
    await page.click("#rescan");
    await page.waitForFunction(() => (window as unknown as { __statuses: string[] }).__statuses.some((t) => t.includes("ページ目を解析中")));
    await page.waitForFunction(() => !document.getElementById("summary")!.hidden && document.getElementById("status-box")!.hidden);
    assert.equal(await docJson(page), edited);
    assert.deepEqual(errors, []);
  });
});

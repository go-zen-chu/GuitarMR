/** The screens: the score list first, scanning and the settings, and going back (the Android back button). */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { ARTIFACTS, PHONE, launch, openPage, openSample, show } from "./helpers.ts";

/** What the Android app's back button does: ask the page, which says whether it went back. */
const back = (page: Page) => page.evaluate(() => (globalThis as unknown as { tky: { back(): boolean } }).tky.back());

const visibleView = (page: Page) => page.locator(".view:not([hidden])").getAttribute("id");

describe("screens", { timeout: 180_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  it("If home opens its score list should show the sample songs tagged as samples, with their covers and no delete", async () => {
    const { page, errors } = await openPage(browser);
    // Home holds the score list, and its tab is named after it.
    assert.equal(await page.locator("#view-library h1").textContent(), "ホーム");
    assert.equal(await page.locator(".score-list h2").textContent(), "楽譜一覧");
    assert.equal(await page.locator('.tabs [data-tab="library"]').textContent(), "ホーム");
    const cards = page.locator("#library-list li.sample-song");
    assert.deepEqual(await cards.locator(".entry-text strong").allTextContents(), ["さくらさくら", "きらきら星", "練習曲"]);
    assert.deepEqual(await cards.locator(".tag").allTextContents(), ["サンプル", "サンプル", "サンプル"]);
    // Before any scan the list is the samples, which cannot be deleted.
    assert.equal(await page.locator("#library-list li").count(), 3);
    assert.equal(await cards.getByRole("button", { name: /削除/ }).count(), 0);
    // The scan-like PDFs show their first page; the gts-only song a drawn cover.
    await page.waitForFunction(() => document.querySelectorAll("#library-list .sample-song .cover img").length === 2, null, { timeout: 60_000 });
    assert.equal(await cards.nth(2).locator(".cover.drawn").count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), PHONE.width);
    await page.screenshot({ path: `${ARTIFACTS}/score-list.png`, fullPage: true });

    // A sample's cover opens it like its button.
    await cards.nth(1).locator(".cover").click();
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "twinkle-twinkle.pdf", null, { timeout: 120_000 });
    assert.equal(await visibleView(page), "view-score");
    assert.deepEqual(errors, []);
  });

  it("If back is pressed it should close the editor, then the play view, then go to the score list, then leave", async () => {
    const { page, errors } = await openPage(browser);
    await openSample(page);
    await page.locator('[data-id="m1"]').click();
    await page.waitForSelector("#sheet:not([hidden])");
    assert.equal(await back(page), true);
    assert.equal(await page.locator("#sheet").isVisible(), false);
    assert.equal(await visibleView(page), "view-score");

    await page.click("#play-open");
    await page.waitForSelector("#player:not([hidden])");
    assert.equal(await back(page), true);
    assert.equal(await page.locator("#player").isVisible(), false);
    assert.equal(await visibleView(page), "view-score");

    assert.equal(await back(page), true);
    await page.waitForSelector("#view-library:not([hidden])");
    assert.equal(await page.evaluate(() => location.hash), "#/");
    assert.equal(await back(page), false);
    assert.deepEqual(errors, []);
  });

  it("If the gear is tapped it should open the settings, and back return to the score list", async () => {
    const { page, errors } = await openPage(browser);
    await show(page, "settings");
    assert.equal(await page.locator("#settings-link").getAttribute("aria-current"), "page");
    assert.equal(await page.locator(".tabs [aria-current]").count(), 0);
    assert.equal(await page.locator("#library").isVisible(), true);
    // Only the Android app has a key of its own to change.
    assert.equal(await page.locator("#api-key").isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), PHONE.width);
    await page.screenshot({ path: `${ARTIFACTS}/settings.png` });
    assert.equal(await back(page), true);
    await page.waitForSelector("#view-library:not([hidden])");
    assert.deepEqual(errors, []);
  });

  it("If the page runs in the Android app the settings should open the app's API key dialog", async () => {
    const { page, errors } = await openPage(browser, {
      setup: (p) =>
        p.addInitScript(() => {
          const w = window as unknown as Record<string, unknown>;
          w.__keyDialogs = 0;
          const settings = { open: () => void (w.__keyDialogs = (w.__keyDialogs as number) + 1) };
          w.claude = { use: async (name: string) => (name === "apiKeySettings" ? settings : null) };
        }),
    });
    await show(page, "settings");
    await page.waitForSelector("#api-key:not([hidden])");
    await page.click("#api-key-open");
    assert.equal(await page.evaluate(() => (window as unknown as { __keyDialogs: number }).__keyDialogs), 1);
    assert.deepEqual(errors, []);
  });

  it("If a score's address is opened it should open that score, and an unknown one the score list", async () => {
    const { page, errors } = await openPage(browser);
    await openSample(page);
    const hash = await page.evaluate(() => location.hash);
    await page.goto("http://localhost/");
    await page.waitForSelector("#view-library:not([hidden])");
    // The built-in sample opens by its address even though it is not listed.
    await page.goto(`http://localhost/${hash}`);
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "sakura-sakura.pdf", null, { timeout: 120_000 });
    assert.equal(await visibleView(page), "view-score");
    await page.goto(`http://localhost/#/score/${"0".repeat(64)}`);
    await page.waitForSelector("#view-library:not([hidden])");
    assert.match((await page.locator("#status").textContent())!, /この端末のライブラリにありません/);
    assert.deepEqual(errors, []);
  });
});

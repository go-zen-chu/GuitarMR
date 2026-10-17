/** Photos as input and the library on the device: correction, page order, reopening. */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { validate } from "@guitarmr/gts/validate";
import { generatePdf, generatePhotos } from "@guitarmr/samples";
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
  });
  after(() => browser?.close());

  it("If pages are photographed one by one they should be cut out, corrected and analyzed as one score", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    await page.setInputFiles("#camera", join(dir, "IMG_0001.jpg"));
    await page.waitForSelector("#tray:not([hidden])");
    await page.setInputFiles("#tray-camera", join(dir, "IMG_0002.jpg"));
    assert.equal(await page.locator("#tray-list li").count(), 2);
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
    assert.equal(await page.locator("#library").isVisible(), false); // the built-in sample is not listed
    await page.setInputFiles("#pdf-file", join(dir, "song.pdf"));
    await page.waitForFunction(() => document.querySelector("#summary-source")?.textContent === "song.pdf", null, { timeout: 120_000 });
    await page.waitForSelector("#library:not([hidden])");
    assert.match((await page.locator("#library-list li").textContent())!, /song\.pdf.*PDF · 未読/);

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
    await page.waitForSelector("#library", { state: "hidden" });
    assert.deepEqual(errors, []);
  });
});

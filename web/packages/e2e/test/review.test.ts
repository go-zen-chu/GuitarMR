/** Reading chords and structure with (a fake) Claude, reviewing, saving, drafts. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { validate } from "@guitarmr/gts/validate";
import type { Browser } from "playwright-core";
import { ARTIFACTS, launch, loadExample, openPage } from "./helpers.ts";

describe("reading and reviewing", { timeout: 240_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  it("If the score is read, edited and saved the file should hold the edits and survive a reload", async () => {
    const { page, errors } = await openPage(browser, { claudeFrom: loadExample("sakura-sakura.gts.json") });
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.equal(await page.locator("#ai").isVisible(), true);

    await page.click("#read");
    await page.waitForFunction(() => document.querySelector("#read-status")?.textContent?.startsWith("読み終わりました"), null, {
      timeout: 60_000,
    });
    const calls = await page.evaluate(() => (window as unknown as { __calls: { ids: string[]; images: number; header: boolean }[] }).__calls);
    // One request per page; the first also carries the page top for the header.
    assert.deepEqual(
      calls.map((c) => [c.ids.length, c.images, c.header]),
      [
        [8, 3, true],
        [7, 2, false],
      ],
    );
    assert.match((await page.locator("#summary-stats").textContent())!, /layout, structure, chords/);
    assert.match((await page.locator("#review-summary").textContent())!, /要確認 1/);

    // The unsure measure opens with the AI's note; a bad chord is refused.
    await page.click("#next-attention");
    await page.waitForSelector("#sheet:not([hidden])");
    assert.match((await page.locator("#sheet-title").textContent())!, /^m3/);
    assert.match((await page.locator("#sheet-note").textContent())!, /かすれている/);
    await page.fill("#f-chords", "Am H7");
    await page.locator("#f-chords").dispatchEvent("change");
    assert.match((await page.locator("#f-chords-error").textContent())!, /H7/);
    await page.fill("#f-chords", "Am Am/G@4");
    await page.click("#sheet-ok");
    assert.match((await page.locator("#sheet-title").textContent())!, /^m4/);
    await page.fill("#f-section", "A2");
    await page.locator("#f-section").dispatchEvent("change");
    await page.screenshot({ path: `${ARTIFACTS}/review-sheet.png` });
    await page.click("#sheet-close");

    await page.click("#save");
    const saved = await page.evaluate(() => (window as unknown as { __saved: { filename: string; data: string }[] }).__saved.at(-1)!);
    assert.equal(saved.filename, "sakura-sakura.gts.json");
    const doc = JSON.parse(saved.data);
    assert.deepEqual(validate(doc), { valid: true, errors: [] });
    const m3 = doc.sections.flatMap((s: { measures: { id: string }[] }) => s.measures).find((m: { id: string }) => m.id === "m3");
    assert.deepEqual(m3.chords, [
      { symbol: "Am", beat: 1 },
      { symbol: "Am/G", beat: 4 },
    ]);
    assert.equal(m3.review.status, "reviewed");
    assert.deepEqual(
      doc.sections.map((s: { label?: string }) => s.label),
      ["A", "A2", "B", "C"],
    );
    assert.equal(doc.meta.title, "さくらさくら");

    // The work in progress comes back after a reload.
    await page.reload();
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.equal(await page.locator("#draft-note").isVisible(), true);
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    assert.deepEqual(errors, []);
  });

  it("If the tab is read after the chords its checks should mark what to fix, and fixing should clear them", async () => {
    const truth = loadExample("sakura-sakura.gts.json") as { sections: { measures: { id: string; beats?: unknown[] }[] }[] };
    const { page, errors } = await openPage(browser, { claudeFrom: truth });
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.equal(await page.locator("#read-tab").isVisible(), false); // chords and structure come first
    await page.click("#read");
    await page.waitForFunction(() => document.querySelector("#read-status")?.textContent?.startsWith("読み終わりました"), null, {
      timeout: 60_000,
    });
    assert.equal(await page.locator("#read-tab").textContent(), "TAB（リズム・フレット）を読む");
    await page.click("#read-tab");
    // The status still says the chords were read; the button goes once every tab is in.
    await page.waitForSelector("#read-tab", { state: "hidden", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector("#read-status")?.textContent?.startsWith("読み終わりました"));
    assert.match((await page.locator("#summary-stats").textContent())!, /layout, structure, chords, tab/);
    // m3 from the chords (unsure), m5 from the tab (a beat short).
    assert.match((await page.locator("#review-summary").textContent())!, /要確認 2/);
    assert.deepEqual(await page.locator("#checks-list li").allTextContents(), ["m5: 拍が足りません（4/4 に 3 拍）"]);
    await page.screenshot({ path: `${ARTIFACTS}/checks.png` });

    await page.locator("#checks-list button").first().click();
    await page.waitForSelector("#sheet:not([hidden])");
    assert.match((await page.locator("#sheet-title").textContent())!, /^m5/);
    assert.match((await page.locator("#sheet-checks").textContent())!, /拍が足りません/);
    assert.match((await page.locator("#sheet-note").textContent())!, /拍が足りません/);
    const fixed = await page.evaluate(
      (beats) => (window as unknown as { formatTabLine(b: unknown[]): string }).formatTabLine(beats),
      truth.sections.flatMap((s) => s.measures).find((m) => m.id === "m5")!.beats!,
    );
    await page.fill("#f-tab", "4:1-0 4:9-1+2-1");
    await page.locator("#f-tab").dispatchEvent("change");
    assert.match((await page.locator("#f-tab-error").textContent())!, /「9-1」/);
    await page.fill("#f-tab", fixed);
    await page.locator("#f-tab").dispatchEvent("input");
    assert.match((await page.locator("#f-tab-total").textContent())!, /合計 4 \/ 4 拍/);
    await page.screenshot({ path: `${ARTIFACTS}/tab-editor.png` });
    await page.click("#sheet-ok");
    await page.click("#sheet-close");
    await page.waitForSelector("#checks", { state: "hidden" });

    // A repeat start inside the existing repeat is caught across measures.
    await page.locator('[data-id="m2"]').click();
    await page.locator("#f-more summary").click();
    await page.check("#f-repeat-start");
    await page.click("#sheet-close");
    assert.match((await page.locator("#checks-list").textContent())!, /m1 のリピート開始 ‖: が閉じないまま、m2 で次のリピートが始まっています/);

    await page.click("#save");
    const saved = await page.evaluate(() => (window as unknown as { __saved: { data: string }[] }).__saved.at(-1)!.data);
    const doc = JSON.parse(saved);
    assert.deepEqual(validate(doc), { valid: true, errors: [] });
    const m5 = doc.sections.flatMap((s: { measures: { id: string }[] }) => s.measures).find((m: { id: string }) => m.id === "m5");
    assert.deepEqual(m5.beats, truth.sections.flatMap((s) => s.measures).find((m) => m.id === "m5")!.beats);
    assert.equal(m5.review.status, "reviewed");
    assert.deepEqual(errors, []);
  });

  it("If the page runs outside claude.ai the reading step should stay hidden", async () => {
    const { page, errors } = await openPage(browser);
    await page.waitForSelector("#summary:not([hidden])", { timeout: 120_000 });
    assert.equal(await page.locator("#ai").isVisible(), false);
    assert.deepEqual(errors, []);
  });
});

/** Reading with (a fake) Claude when things go wrong or are redone: stopping, limits, refusals, bad answers, re-reading. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { type FakeClaude, analyzed, launch, loadExample, openPage, readEnded } from "./helpers.ts";

type Measure = { id: string; chords?: { symbol: string; beat?: number }[]; review?: { status: string } };
type Doc = { meta: Record<string, unknown>; sections: { label?: string; measures: Measure[] }[] };

const truth = loadExample("sakura-sakura.gts.json") as Doc;
const truthMeasure = (id: string) => truth.sections.flatMap((s) => s.measures).find((m) => m.id === id)!;
const docOf = async (page: Page): Promise<Doc> => JSON.parse(await page.locator("#json").inputValue());
const measureOf = async (page: Page, id: string) => (await docOf(page)).sections.flatMap((s) => s.measures).find((m) => m.id === id)!;
const calls = (page: Page) => page.evaluate(() => (window as unknown as { __calls: { ids: string[]; header: boolean }[] }).__calls);

describe("reading with Claude, when things go wrong or are redone", { timeout: 300_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  async function open(claude: Partial<FakeClaude> = {}) {
    const opened = await openPage(browser, { claude: { truth, ...claude } });
    await analyzed(opened.page, "sakura-sakura.pdf");
    await opened.page.waitForSelector("#ai:not([hidden])");
    return opened;
  }

  it("If reading is stopped it should keep what was read and continue from the unread pages", async () => {
    const { page, errors } = await open({ delay: 1500 });
    await page.click("#read");
    await page.waitForFunction(() => document.querySelector("#read-status")?.textContent?.includes("p1 を読んでいます"));
    assert.equal(await page.locator("#read").isDisabled(), true);
    // Stop while page 2 is being read: page 1 is kept.
    await page.waitForFunction(() => document.querySelector("#read-status")?.textContent?.includes("p2 を読んでいます"), null, { timeout: 10_000 });
    await page.click("#stop");
    await readEnded(page);
    assert.match((await page.locator("#read-status").textContent())!, /止めました/);
    assert.equal(await page.locator("#read").textContent(), "続きを読む（未読 7 小節）");
    assert.equal(await page.locator("#stop").isVisible(), false);
    await page.click("#read");
    await readEnded(page);
    assert.match((await page.locator("#read-status").textContent())!, /読み終わりました/);
    assert.equal(await page.locator("#read").isVisible(), false);
    assert.doesNotMatch((await page.locator("#review-summary").textContent())!, /未読/);
    // Only page 2 was asked again.
    assert.deepEqual(
      (await calls(page)).map((c) => c.ids[0]),
      ["m1", "m9", "m9"],
    );
    assert.deepEqual(errors, []);
  });

  it("If Claude's usage limit is hit it should say to wait, and reading again should finish", async () => {
    const { page, errors } = await open({ errors: { 2: "rate_limited" } });
    await page.click("#read");
    await readEnded(page);
    assert.match((await page.locator("#read-status").textContent())!, /利用上限に達しました/);
    // Page 1 was read before the limit; page 2 is still to read.
    assert.equal(await page.locator("#read").textContent(), "続きを読む（未読 7 小節）");
    assert.equal(await page.locator("#ai").isVisible(), true);
    await page.click("#read");
    await readEnded(page);
    assert.match((await page.locator("#read-status").textContent())!, /読み終わりました/);
    assert.deepEqual(
      (await calls(page)).map((c) => c.ids.length),
      [8, 7, 7],
    );
    assert.deepEqual(errors, []);
  });

  it("If Claude may not be used the reading step should go away", async () => {
    const { page, errors } = await open({ errors: { 1: "not_granted" } });
    assert.equal(await page.locator(".reread").first().isVisible(), true);
    await page.click("#read");
    await page.waitForSelector("#ai", { state: "hidden" });
    assert.equal(await page.locator(".reread").first().isVisible(), false);
    // Reviewing by hand still works.
    await page.locator('[data-id="m1"]').click();
    await page.waitForSelector("#sheet:not([hidden])");
    assert.deepEqual(errors, []);
  });

  it("If one page's answer cannot be read the others should still be read and the problem listed", async () => {
    const { page, errors } = await open({ errors: { 1: "invalid_json" } });
    await page.click("#read");
    await readEnded(page);
    assert.match((await page.locator("#read-status").textContent())!, /読み終わりました/);
    await page.locator("#read-warnings summary").click();
    assert.deepEqual(await page.locator("#read-warnings li").allTextContents(), ["p1: 答えを読み取れませんでした（invalid_json）"]);
    assert.equal(await page.locator("#read").textContent(), "続きを読む（未読 8 小節）");
    // The header comes with the first page, so it is read when p1 is.
    assert.notEqual((await docOf(page)).meta.key, truth.meta.key);
    await page.click("#read");
    await readEnded(page);
    const doc = await docOf(page);
    assert.deepEqual(
      [doc.meta.title, doc.meta.key, doc.meta.tempo, doc.meta.timeSignature],
      [truth.meta.title, truth.meta.key, truth.meta.tempo, truth.meta.timeSignature],
    );
    assert.equal(await page.locator("#read-warnings").isVisible(), false);
    assert.deepEqual(errors, []);
  });

  it("If a page is read again it should replace that page's edits and leave the other pages alone", async () => {
    const { page, errors } = await open();
    await page.click("#read");
    await readEnded(page);
    for (const id of ["m1", "m9"]) {
      await page.locator(`[data-id="${id}"]`).click();
      await page.fill("#f-chords", "C");
      await page.locator("#f-chords").dispatchEvent("change");
      await page.click("#sheet-ok");
    }
    await page.click("#sheet-close");
    const before = (await calls(page)).length;
    await page.locator(".page").first().locator(".reread").click();
    await page.waitForFunction((n) => (window as unknown as { __calls: unknown[] }).__calls.length === n + 1, before);
    await page.waitForFunction(() => !(document.querySelector("#read") as HTMLButtonElement).disabled);
    const last = (await calls(page)).at(-1)!;
    assert.deepEqual(last.ids, ["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
    assert.deepEqual((await measureOf(page, "m1")).chords, truthMeasure("m1").chords);
    assert.equal((await measureOf(page, "m1")).review?.status, "auto");
    assert.deepEqual((await measureOf(page, "m9")).chords, [{ symbol: "C", beat: 1 }]);
    assert.equal((await measureOf(page, "m9")).review?.status, "reviewed");
    assert.deepEqual(errors, []);
  });

  it("If measures need review the button should walk through them in order and wrap around", async () => {
    const { page, errors } = await open();
    await page.click("#read");
    await readEnded(page);
    await page.click("#read-tab");
    await page.waitForSelector("#read-tab", { state: "hidden", timeout: 60_000 });
    const titles: string[] = [];
    for (let i = 0; i < 3; i++) {
      await page.click("#next-attention");
      titles.push((await page.locator("#sheet-title").textContent())!.split("（")[0]!);
    }
    // m3 is unsure about its chords, m5 is a beat short in the tab.
    assert.deepEqual(titles, ["m3", "m5", "m3"]);
    assert.deepEqual(errors, []);
  });
});

/** Fixing detected measures by hand: split, joined, deleted, a page left out and brought back, and undo, also of typed fields. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { validate } from "@guitarmr/gts/validate";
import type { Browser, Page } from "playwright-core";
import { ARTIFACTS, analyzed, launch, openPage, openSample } from "./helpers.ts";

type Measure = { id: string; region: { page: number; bbox: number[] }; chords?: unknown[] };
type Doc = { sections: { label?: string; measures: Measure[] }[]; source: { pages: { index: number }[] } };

const docOf = async (page: Page): Promise<Doc> => JSON.parse(await page.locator("#json").inputValue());
const all = async (page: Page) => (await docOf(page)).sections.flatMap((s) => s.measures);
const ids = async (page: Page) => (await all(page)).map((m) => m.id);
const countOf = (n: number) => Array.from({ length: n }, (_, i) => `m${i + 1}`);

/** Wait until the library on the device holds a document with `count` measures (saving is asynchronous). */
const savedWith = (page: Page, count: number) =>
  page.waitForFunction(
    (n) =>
      new Promise<boolean>((resolve) => {
        const open = indexedDB.open("guitarmr");
        open.onsuccess = () => {
          const all = open.result.transaction("scores").objectStore("scores").getAll();
          all.onsuccess = () => {
            const docs = (all.result as { doc?: { sections: { measures: unknown[] }[] } }[]).map((e) => e.doc);
            resolve(docs.some((d) => d?.sections.flatMap((x) => x.measures).length === n));
            open.result.close();
          };
        };
        open.onerror = () => resolve(false);
      }),
    count,
  );

/** Tap the measure image at `share` of the framed measure's width. */
async function tapInMeasure(page: Page, share: number) {
  const frame = (await page.locator("#sheet-frame").boundingBox())!;
  await page.mouse.click(frame.x + share * frame.width, frame.y + frame.height / 2);
}

describe("fixing detected measures", { timeout: 300_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  async function open() {
    const opened = await openPage(browser);
    await openSample(opened.page);
    return opened;
  }

  it("If a measure is split where the image is tapped it should become two, and undo should bring it back", async () => {
    const { page, errors } = await open();
    const before = await all(page);
    await page.locator('[data-id="m2"]').click();
    await page.click("#f-split");
    assert.equal(await page.locator("#f-split-hint").isVisible(), true);
    await page.screenshot({ path: `${ARTIFACTS}/regions-split.png` });
    await tapInMeasure(page, 0.4);
    const after = await all(page);
    assert.deepEqual(after.map((m) => m.id), countOf(16));
    const [x0, , x1] = before[1]!.region.bbox as [number, number, number];
    const cut = after[1]!.region.bbox[2]!;
    assert.ok(Math.abs(cut - (x0 + 0.4 * (x1 - x0))) < 0.01, `cut at ${cut}`);
    assert.equal(after[2]!.region.bbox[0], cut);
    assert.equal(after[2]!.region.bbox[2], x1);
    // The sheet stays on the left part, and the split mode is over.
    assert.match((await page.locator("#sheet-title").textContent())!, /^m2（/);
    assert.equal(await page.locator("#f-split").getAttribute("aria-pressed"), "false");
    assert.match((await page.locator("#undo-message").textContent())!, /2 小節目を2つに分けました/);
    await page.click("#undo");
    assert.deepEqual(await all(page), before);
    assert.deepEqual(errors, []);
  });

  it("If measures are joined and deleted they should be numbered in order again, also after a reload", async () => {
    const { page, errors } = await open();
    const before = await all(page);
    await page.locator('[data-id="m1"]').click();
    await page.click("#f-merge");
    const joined = await all(page);
    assert.deepEqual(joined.map((m) => m.id), countOf(14));
    assert.deepEqual(joined[0]!.region.bbox, [before[0]!.region.bbox[0], before[0]!.region.bbox[1], before[1]!.region.bbox[2], before[1]!.region.bbox[3]]);
    // The last measure of a system has no neighbor to join with.
    await page.locator('[data-id="m3"]').click();
    assert.equal(await page.locator("#f-merge").isDisabled(), true);
    await page.click("#f-delete");
    assert.deepEqual(await ids(page), countOf(13));
    // The sheet moves on to the measure that followed the deleted one.
    assert.deepEqual((await all(page))[2]!.region, before[4]!.region);
    assert.match((await page.locator("#sheet-title").textContent())!, /^m3（/);
    assert.deepEqual(validate(await docOf(page)), { valid: true, errors: [] });
    await savedWith(page, 13);
    await page.reload();
    await analyzed(page, "sakura-sakura.pdf");
    assert.deepEqual(await ids(page), countOf(13));
    assert.deepEqual(errors, []);
  });

  it("If a deleted measure's notice is gone it should still come back from the sheet, and a typed chord too", async () => {
    const { page, errors } = await open();
    const before = await all(page);
    await page.locator('[data-id="m2"]').click();
    assert.equal(await page.locator("#sheet-undo").isDisabled(), true);
    await page.click("#f-delete");
    assert.deepEqual(await ids(page), countOf(14));
    await page.locator("#undo-bar").waitFor({ state: "hidden", timeout: 15_000 });
    await page.click("#sheet-undo");
    assert.deepEqual(await all(page), before);
    // The sheet stays on m2, now the measure brought back.
    assert.match((await page.locator("#sheet-title").textContent())!, /^m2（/);
    await page.fill("#f-chords", "Am");
    await page.press("#f-chords", "Enter");
    await page.click("#sheet-close");
    assert.notDeepEqual((await all(page))[1]!.chords, before[1]!.chords);
    await page.click("#undo-edit");
    assert.deepEqual(await all(page), before);
    assert.equal(await page.locator("#undo-edit").isHidden(), true);
    assert.deepEqual(errors, []);
  });

  it("If a page is left out its measures should go, and bringing it back should restore them in page order", async () => {
    const { page, errors } = await open();
    const before = await all(page);
    const p1 = page.locator('.page[data-page="0"] .page-remove');
    const p2 = page.locator('.page[data-page="1"] .page-remove');
    await p1.click();
    let now = await all(page);
    assert.ok(now.every((m) => m.region.page === 1));
    assert.deepEqual(now.map((m) => m.id), countOf(now.length));
    assert.deepEqual((await docOf(page)).source.pages.map((p) => p.index), [1]);
    assert.equal(await p1.textContent(), "このページを戻す");
    assert.equal(await page.locator('.page[data-page="0"] .overlay .system').count(), 0);
    // The only page left cannot be left out too.
    assert.equal(await p2.isDisabled(), true);
    await page.screenshot({ path: `${ARTIFACTS}/regions-page-out.png`, fullPage: true });
    await p1.click();
    now = await all(page);
    assert.deepEqual(now, before);
    assert.equal(await p1.textContent(), "このページを外す");
    assert.deepEqual(validate(await docOf(page)), { valid: true, errors: [] });
    assert.deepEqual(errors, []);
  });
});

/** The measure editor by hand (no Claude): moving around, every field, sections, starting over. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { validate } from "@guitarmr/gts/validate";
import type { Browser, Page } from "playwright-core";
import { ARTIFACTS, analyzed, launch, openPage } from "./helpers.ts";

type Measure = Record<string, unknown> & { id: string };
type Doc = { sections: { label?: string; measures: Measure[] }[] };

const docOf = async (page: Page): Promise<Doc> => JSON.parse(await page.locator("#json").inputValue());
const measureOf = async (page: Page, id: string) => (await docOf(page)).sections.flatMap((s) => s.measures).find((m) => m.id === id)!;
const title = async (page: Page) => (await page.locator("#sheet-title").textContent())!.split("（")[0];
const label = (page: Page, id: string) => page.locator(`[data-id="${id}"]`).getAttribute("aria-label");

describe("editing measures by hand", { timeout: 300_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  async function open() {
    const opened = await openPage(browser);
    await analyzed(opened.page, "sakura-sakura.pdf");
    return opened;
  }

  it("If measures are opened by tap, keyboard and the arrows the editor should follow, and Escape close it", async () => {
    const { page, errors } = await open();
    await page.locator('[data-id="m1"]').click();
    assert.equal(await title(page), "m1");
    assert.match((await page.locator("#sheet-status").textContent())!, /未読/);
    await page.click("#sheet-next");
    assert.equal(await title(page), "m2");
    await page.click("#sheet-prev");
    await page.click("#sheet-prev"); // before the first measure: the editor closes
    assert.equal(await page.locator("#sheet").isVisible(), false);
    await page.locator('[data-id="m8"]').focus();
    await page.keyboard.press("Enter");
    assert.equal(await title(page), "m8");
    // The page measures continue across pages: m9 is on p2.
    await page.click("#sheet-next");
    assert.match((await page.locator("#sheet-title").textContent())!, /^m9（p2）/);
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#sheet").isVisible(), false);
    await page.locator('[data-id="m3"]').focus();
    await page.keyboard.press(" ");
    assert.equal(await title(page), "m3");
    assert.deepEqual(errors, []);
  });

  it("If chords are typed with beats they should be placed there, and bad ones refused", async () => {
    const { page, errors } = await open();
    await page.locator('[data-id="m2"]').click();
    await page.fill("#f-chords", "Am G/B@4");
    await page.locator("#f-chords").dispatchEvent("change");
    assert.deepEqual((await measureOf(page, "m2")).chords, [
      { symbol: "Am", beat: 1 },
      { symbol: "G/B", beat: 4 },
    ]);
    // An even split needs no @: two chords in 4/4 land on 1 and 3.
    await page.fill("#f-chords", "C G");
    await page.locator("#f-chords").dispatchEvent("change");
    assert.deepEqual((await measureOf(page, "m2")).chords, [
      { symbol: "C", beat: 1 },
      { symbol: "G", beat: 3 },
    ]);
    await page.fill("#f-chords", "C@5");
    await page.locator("#f-chords").dispatchEvent("change");
    assert.match((await page.locator("#f-chords-error").textContent())!, /「C@5」/);
    // The refused line keeps the measure from being marked reviewed.
    await page.click("#sheet-ok");
    assert.equal(await title(page), "m2");
    assert.notEqual((await measureOf(page, "m2")).review, { status: "reviewed" });
    assert.deepEqual(errors, []);
  });

  it("If bar lines and signs are set they should show over the measure, be saved and be checked", async () => {
    const { page, errors } = await open();
    await page.locator('[data-id="m4"]').click();
    await page.locator("#f-more summary").click();
    assert.equal(await page.locator("#f-repeat-times").isDisabled(), true);
    await page.selectOption("#f-bar-end", "repeat-end");
    assert.equal(await page.locator("#f-repeat-times").isDisabled(), false);
    await page.fill("#f-repeat-times", "3");
    await page.locator("#f-repeat-times").dispatchEvent("change");
    await page.fill("#f-volta", "1、2");
    await page.locator("#f-volta").dispatchEvent("change");
    await page.check("#f-nav-ds");
    assert.match((await label(page, "m4"))!, /1,2\. .*D\.S\. :‖×3/);
    assert.deepEqual(
      (({ barEnd, repeatTimes, volta, navigation }) => ({ barEnd, repeatTimes, volta, navigation }))(await measureOf(page, "m4")),
      { barEnd: "repeat-end", repeatTimes: 3, volta: [1, 2], navigation: ["ds"] },
    );
    // A D.S. with nowhere to go back to is caught, and fixed by a segno.
    assert.match((await page.locator("#sheet-checks").textContent())!, /セーニョ 𝄋 がありません/);
    await page.click("#sheet-prev");
    await page.click("#sheet-prev");
    await page.click("#sheet-prev");
    assert.equal(await title(page), "m1");
    await page.check("#f-nav-segno");
    assert.doesNotMatch((await page.locator("#checks-list").textContent()) ?? "", /セーニョ/);

    // A one-measure repeat sign has no tab of its own.
    await page.click("#sheet-next");
    await page.selectOption("#f-simile", "1");
    assert.equal(await page.locator("#f-tab").isDisabled(), true);
    assert.equal(await page.locator("#f-tab").getAttribute("placeholder"), "繰り返し記号の小節（前の小節と同じ）");
    assert.match((await label(page, "m2"))!, /%/);
    await page.screenshot({ path: `${ARTIFACTS}/editor-signs.png` });

    // Back to an ordinary bar line: the repeat count goes with the repeat.
    await page.locator('[data-id="m4"]').click();
    await page.selectOption("#f-bar-end", "");
    assert.equal(await page.locator("#f-repeat-times").isDisabled(), true);
    const m4 = await measureOf(page, "m4");
    assert.equal(m4.barEnd, undefined);
    assert.equal(m4.repeatTimes, undefined);
    assert.deepEqual(validate(await docOf(page)), { valid: true, errors: [] });
    assert.deepEqual(errors, []);
  });

  it("If sections are started and cleared the measures should regroup under them", async () => {
    const { page, errors } = await open();
    const labels = async () => (await docOf(page)).sections.map((s) => [s.label ?? "", s.measures.length]);
    assert.deepEqual(await labels(), [["", 15]]);
    // Typed and left by tapping the next measure, as on a phone: the tap must still open it.
    await page.locator('[data-id="m1"]').click();
    await page.fill("#f-section", "Intro");
    await page.locator('[data-id="m5"]').click();
    assert.equal(await title(page), "m5");
    await page.fill("#f-section", "サビ");
    await page.locator("#f-section").dispatchEvent("change");
    assert.deepEqual(await labels(), [
      ["Intro", 4],
      ["サビ", 11],
    ]);
    assert.match((await label(page, "m5"))!, /\[サビ\]/);
    await page.fill("#f-section", "");
    await page.locator("#f-section").dispatchEvent("change");
    assert.deepEqual(await labels(), [["Intro", 15]]);
    assert.deepEqual(errors, []);
  });

  it("If the draft is thrown away the detected layout should come back, also after a reload", async () => {
    const { page, errors } = await open();
    assert.equal(await page.locator("#draft-note").isVisible(), false);
    await page.locator('[data-id="m1"]').click();
    await page.click("#sheet-ok");
    await page.click("#sheet-close");
    await page.reload();
    await analyzed(page, "sakura-sakura.pdf");
    assert.equal(await page.locator("#draft-note").isVisible(), true);
    assert.match((await page.locator("#review-summary").textContent())!, /確認済み 1/);
    await page.click("#discard-draft");
    assert.equal(await page.locator("#draft-note").isVisible(), false);
    assert.equal((await page.locator("#review-summary").textContent())!.trim(), "未読 15");
    await page.reload();
    await analyzed(page, "sakura-sakura.pdf");
    assert.equal(await page.locator("#draft-note").isVisible(), false);
    assert.equal((await page.locator("#review-summary").textContent())!.trim(), "未読 15");
    assert.deepEqual(errors, []);
  });
});

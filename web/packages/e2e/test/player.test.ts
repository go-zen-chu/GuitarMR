/** The play view: order, layout on phone and tablet, beat marks, playback. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { ARTIFACTS, PHONE, TABLET, launch, openPage } from "./helpers.ts";

async function openPlayer(browser: Browser, sample: string, options = {}) {
  const opened = await openPage(browser, options);
  await opened.page.locator("#play-samples .sample", { hasText: sample }).click();
  await opened.page.waitForSelector("#player:not([hidden])");
  return opened;
}

/** Per row: spread (px) of chord bottoms, lyric bottoms and chord text sizes. */
function rowAlignment(page: Page) {
  return page.evaluate(() => {
    const rows = new Map<number, { chord: number[]; lyric: number[]; sizes: number[] }>();
    for (const bar of document.querySelectorAll<HTMLElement>("#player-bars .bar")) {
      const row = rows.get(bar.offsetTop) ?? { chord: [], lyric: [], sizes: [] };
      const chords = [...bar.querySelectorAll(".chord")].map((n) => n.getBoundingClientRect().bottom);
      if (chords.length) row.chord.push(Math.max(...chords));
      const lyric = bar.querySelector(".lyric");
      if (lyric?.textContent) row.lyric.push(lyric.getBoundingClientRect().bottom);
      row.sizes.push(parseFloat(getComputedStyle(bar.querySelector(".chords")!).fontSize));
      rows.set(bar.offsetTop, row);
    }
    const spread = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0);
    return [...rows.values()].map((r) => ({ chord: spread(r.chord), lyric: spread(r.lyric), sizes: spread(r.sizes) }));
  });
}

const currentMarks = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>(".bar.current")!;
    const ticks = [...bar.querySelectorAll(".tick")];
    return { k: Number(bar.dataset.k), n: ticks.length, now: ticks.findIndex((t) => t.classList.contains("now")) };
  });

describe("play view", { timeout: 180_000 }, () => {
  let browser: Browser;
  before(async () => {
    browser = await launch();
  });
  after(() => browser?.close());

  for (const [name, viewport, perRow] of [
    ["phone", PHONE, [2, 2]],
    ["tablet", TABLET, [4, 6]],
  ] as const) {
    it(`If a song opens on a ${name} it should flow in play order with chords and lyrics level`, async () => {
      const { page, errors } = await openPlayer(browser, "さくらさくら", { viewport });
      const info = await page.evaluate(() => {
        const bars = [...document.querySelectorAll<HTMLElement>("#player-bars .bar")];
        return { bars: bars.length, rows: new Set(bars.map((b) => b.offsetTop)).size, width: document.querySelector("#player")!.scrollWidth };
      });
      // 14 measures, the repeat to the 1st ending, then the 2nd ending.
      assert.equal(info.bars, 28);
      const columns = info.bars / info.rows;
      assert.ok(columns >= perRow[0] && columns <= perRow[1], `${columns} measures per row`);
      assert.equal(info.width, viewport.width);
      for (const row of await rowAlignment(page)) {
        // Level within a pixel, one text size per row (sub-pixel rounding aside).
        assert.ok(row.chord <= 1.5 && row.lyric <= 1.5 && row.sizes <= 0.1, JSON.stringify(row));
      }
      await page.screenshot({ path: `${ARTIFACTS}/player-${name}.png` });
      assert.deepEqual(errors, []);
    });
  }

  it("If the feel is switched the beat marks should follow and fill in while playing", async () => {
    const { page, errors } = await openPlayer(browser, "さくらさくら");
    assert.deepEqual(await currentMarks(page), { k: 0, n: 4, now: 0 });
    await page.fill("#player-bpm", "240");
    await page.locator("#player-bpm").dispatchEvent("change");
    await page.click("#player-play");
    // One measure of count-in (1 s at 240 BPM), then the song.
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>(".bar.current")?.dataset.k) >= 2, null, {
      timeout: 10_000,
    });
    await page.click('#player-feel [data-feel="16"]');
    let marks = await currentMarks(page);
    assert.equal(marks.n, 16);
    assert.ok(marks.now >= 0 && marks.now < 16);
    await page.click('#player-feel [data-feel="8"]');
    marks = await currentMarks(page);
    assert.equal(marks.n, 8);
    // Playing scrolls the view along.
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>(".bar.current")?.dataset.k) >= 10, null, {
      timeout: 15_000,
    });
    assert.ok((await page.evaluate(() => document.querySelector("#player")!.scrollTop)) > 100);
    await page.click("#player-play");
    // A tap jumps to a measure.
    await page.locator('#player-bars .bar[data-k="3"]').click();
    assert.equal((await currentMarks(page)).k, 3);
    assert.deepEqual(errors, []);
  });

  it("If a song has D.S. al Coda and chord shapes they should be expanded and drawn", async () => {
    const { page, errors } = await openPlayer(browser, "練習曲", { colorScheme: "dark" });
    const heads = await page.locator("#player-bars .bar .bar-head").allTextContents();
    assert.equal(heads.length, 12);
    assert.match(heads.at(-1)!, /\[Coda\]/);
    assert.equal(await page.locator("#player-bars .diagram").count(), 1);
    await page.screenshot({ path: `${ARTIFACTS}/player-etude-dark.png` });
    assert.deepEqual(errors, []);
  });
});

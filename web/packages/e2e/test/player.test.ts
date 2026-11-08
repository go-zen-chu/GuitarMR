/** The play view: order, layout on phone and tablet, beat marks, playback. */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type { Browser, Page } from "playwright-core";
import { ARTIFACTS, PHONE, TABLET, launch, openPage } from "./helpers.ts";

async function openPlayer(browser: Browser, sample: string, options = {}) {
  const opened = await openPage(browser, options);
  await opened.page.locator("#sample-list li", { hasText: sample }).getByRole("button", { name: "演奏ビュー" }).click();
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

  it("If a song is played it should sound its chords and tab, each only while switched on", async () => {
    const { page, errors } = await openPlayer(browser, "練習曲", {
      // Count the plucked strings the page starts.
      setup: (p: Page) =>
        p.addInitScript(() => {
          const w = window as unknown as { __plucks: number };
          w.__plucks = 0;
          const start = AudioBufferSourceNode.prototype.start;
          AudioBufferSourceNode.prototype.start = function (...args: Parameters<typeof start>) {
            w.__plucks++;
            return start.apply(this, args);
          };
        }),
    });
    const plucks = () => page.evaluate(() => (window as unknown as { __plucks: number }).__plucks);
    assert.equal(await page.locator("#player-chord-sound").isVisible(), true);
    assert.equal(await page.locator("#player-tab-sound").isVisible(), true);
    await page.fill("#player-bpm", "240");
    await page.locator("#player-bpm").dispatchEvent("change");
    await page.click("#player-play");
    await page.waitForFunction(() => (window as unknown as { __plucks: number }).__plucks > 10, null, { timeout: 10_000 });
    await page.click("#player-play");

    // Both switched off: playing on stays silent.
    await page.uncheck("#player-chord-sound");
    await page.uncheck("#player-tab-sound");
    const before = await plucks();
    await page.click("#player-play");
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>(".bar.current")?.dataset.k) >= 2, null, { timeout: 10_000 });
    await page.click("#player-play");
    assert.equal(await plucks(), before);
    assert.deepEqual(errors, []);
  });

  it("If 解説 is turned on it should show the degrees and bracket the progressions, a name opening its details", async () => {
    const { page, errors } = await openPlayer(browser, "さくらさくら", { viewport: PHONE });
    assert.equal(await page.locator("#player-notes").isVisible(), false);
    assert.equal(await page.locator("#player-bars .degrees").first().isVisible(), false);
    await page.click("#player-explain");
    assert.equal(await page.getAttribute("#player-explain", "aria-pressed"), "true");
    assert.deepEqual(await page.locator('#player-bars .bar[data-k="0"] .degree').allTextContents(), ["Ⅰm", "Ⅴsus4"]);
    assert.match(await page.locator("#player-notes").textContent() ?? "", /Key Am（A マイナー）.*楽譜の表記.*カポ2で実音は Bm/);

    // The scale, near the top; its name opens what it is and where it lies on the neck.
    const scale = page.locator('#player-notes .scale-name[data-scale="main"]');
    assert.equal(await scale.locator("span").textContent(), "A ヨナ抜き短音階（平調子）");
    // The English name guitarists use, next to the Japanese one.
    assert.equal(await scale.locator(".scale-alias").textContent(), "A Hirajoshi scale");
    assert.equal(await page.locator("#player-notes .scale-notes").textContent(), "A B C E F");
    await scale.click();
    assert.equal(await page.locator("#player-detail h3").textContent(), "A ヨナ抜き短音階（平調子）");
    assert.equal(await page.locator("#player-detail .detail-alias").textContent(), "A Hirajoshi scale");
    assert.deepEqual(await page.locator("#player-detail .scale-note small").allTextContents(), ["1", "2", "♭3", "5", "♭6"]);
    assert.match(await page.locator("#player-detail").textContent() ?? "", /同じ音の並び: E 都節音階（陰音階） \/ E In scale \(Miyako-bushi\)/);
    // 5 notes on 6 strings over 13 frets (open to 12th).
    assert.ok((await page.locator("#player-detail .fretboard circle").count()) >= 30);
    await page.screenshot({ path: `${ARTIFACTS}/player-scale-phone.png` });
    await page.locator("#player-notes .notes-others .scale-name").first().click();
    assert.equal(await page.locator("#player-detail h3").textContent(), "A ナチュラルマイナースケール（自然短音階）");
    assert.match(await page.locator("#player-detail .detail-text").textContent() ?? "", /A B C D E F G A/);
    await page.click("#player-detail-close");
    for (const row of await rowAlignment(page)) {
      assert.ok(row.chord <= 1.5 && row.lyric <= 1.5 && row.sizes <= 0.1, JSON.stringify(row));
    }

    // The Ⅱ→Ⅴ→Ⅰ starts at the Bm7-5 of measure 13 and runs into measure 14 (the 1st ending).
    const name = page.locator('#player-bars .bar[data-k="12"] .bracket-name', { hasText: "ツーファイブワン" });
    const bracket = await page.evaluate(() => {
      const bar = document.querySelector('#player-bars .bar[data-k="12"]')!;
      const from = bar.querySelector<HTMLElement>(".bracket.from")!.getBoundingClientRect();
      const chord = bar.querySelectorAll(".chords .chord")[2]!.getBoundingClientRect();
      return { offset: Math.abs(from.left - chord.left), next: !!document.querySelector('#player-bars .bar[data-k="13"] .bracket') };
    });
    assert.ok(bracket.offset <= 1, JSON.stringify(bracket));
    assert.equal(bracket.next, true);
    assert.equal(await page.locator("#player-detail").isVisible(), false);
    const current = (await currentMarks(page)).k;
    await name.click();
    assert.equal(await page.locator("#player-detail").isVisible(), true);
    assert.equal(await page.locator("#player-detail h3").textContent(), "ツーファイブワン");
    assert.equal(await page.locator("#player-detail .detail-degrees").textContent(), "Ⅱm7-5 → Ⅴ7 → Ⅰm");
    assert.match(await page.locator("#player-detail .detail-text").textContent() ?? "", /解決/);
    // Tapping the name explains; it does not move the play position.
    assert.equal((await currentMarks(page)).k, current);
    const picked = await page.$$eval("#player-bars .bar.picked", (bars) => bars.map((b) => Number((b as HTMLElement).dataset.k)));
    assert.equal(picked[0], 12);
    assert.ok(picked.length >= 2, `${picked.length} measures marked`);
    await page.screenshot({ path: `${ARTIFACTS}/player-explain-phone.png` });

    // Another place of a progression, from the details: marked, and the view goes there.
    await page.locator('#player-bars .bracket-name', { hasText: "カデンツ" }).first().click();
    const places = page.locator("#player-detail .detail-place");
    assert.ok((await places.count()) >= 2);
    const second = Number((await places.nth(1).textContent())!.replace(/\D/g, ""));
    await places.nth(1).click();
    assert.equal((await currentMarks(page)).k, second - 1);
    assert.equal(await page.locator("#player-bars .bar.picked").first().getAttribute("data-k"), String(second - 1));

    // Closing the details, then 解説 off: nothing extra is left; the choice is remembered.
    await page.click("#player-detail-close");
    assert.equal(await page.locator("#player-detail").isVisible(), false);
    assert.equal(await page.locator("#player-bars .bar.picked").count(), 0);
    await page.click("#player-explain");
    assert.equal(await page.locator("#player-bars .brackets").first().isVisible(), false);
    await page.click("#player-explain");
    await page.click("#player-close");
    await page.reload();
    await page.locator("#sample-list li", { hasText: "練習曲" }).getByRole("button", { name: "演奏ビュー" }).click();
    assert.equal(await page.locator("#player-notes").isVisible(), true);
    assert.equal(await page.locator("#player-bars .bracket-name").first().textContent(), "小室進行");
    assert.deepEqual(errors, []);
  });

  it("If the device is in English the page and the play view's explanation should be in English", async () => {
    const { page, errors } = await openPage(browser, { locale: "en-US" });
    assert.equal(await page.getAttribute("html", "lang"), "en");
    assert.equal(await page.locator("#library-title").textContent(), "Scores");
    assert.equal(await page.locator('.tabs [data-tab="scan"]').textContent(), "Scan");
    await page.locator("#sample-list li", { hasText: "さくらさくら" }).getByRole("button", { name: "Play view" }).click();
    await page.waitForSelector("#player:not([hidden])");
    assert.equal(await page.locator("#player-play").textContent(), "Play");
    assert.match(await page.locator("#player-meta").textContent() ?? "", /28 measures/);
    await page.click("#player-explain");
    assert.equal(await page.locator("#player-explain").textContent(), "Explain");
    assert.match(await page.locator("#player-notes .notes-head").textContent() ?? "", /Key Am \(A minor\)/);
    const scale = page.locator('#player-notes .scale-name[data-scale="main"]');
    assert.equal(await scale.textContent(), "A Hirajoshi scale (yonanuki minor)");
    assert.equal(await scale.locator(".scale-alias").count(), 0);
    await page.locator("#player-bars .bracket-name", { hasText: "Two-five-one" }).first().click();
    assert.match(await page.locator("#player-detail .detail-chords").textContent() ?? "", /\(from measure 13\)/);
    await page.click("#player-play");
    assert.equal(await page.locator("#player-play").textContent(), "Pause");
    await page.click("#player-play");
    await page.screenshot({ path: `${ARTIFACTS}/player-explain-en.png` });
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

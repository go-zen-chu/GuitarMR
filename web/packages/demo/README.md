# @guitarmr/demo

**tky**: a single HTML file that digitizes a scanned guitar score on a
phone, as the first step toward the phone/tablet PWA (ADR-009). It opens on
the home screen (ホーム) with the score list (楽譜一覧) in it; scanning is
the other tab (スキャン), a finished scan opens its score, and the settings
are behind the gear (ADR-009 amendment 2026-11-02). The screen is kept in the URL hash (`src/router.ts`).

1. Pick a scanned PDF, or take photos of the pages ("カメラで撮る", one
   photo per page; several photos can also be picked at once). Photos
   wait in a tray where they are put in page order, then are analyzed
   together. Every PDF page is rendered with pdf.js, every photo decoded
   (EXIF orientation applied), and analyzed in a Web Worker on the device
   (layoutscan): a photo is corrected first (`correctPhoto`: the white
   sheet cut out, perspective undone, lighting flattened), then
   orientation, systems and measures give the `layout` layer. Photo pages
   show the original photo with the sheet's outline under the corrected
   page.
2. "読み取る" sends one image per system (with measure-id tags) to Claude
   on the viewer's own claude.ai account, one request per page, and fills
   the `structure` and `chords` layers (`@guitarmr/extract`). The PDF
   itself (or the photo) is never sent; for photos the images are cut
   from the corrected page. A request that cannot reach Claude is asked
   again twice (after 2 s and 6 s, `src/retry.ts`); if it still fails,
   the status says so with what went wrong underneath (an HTTP status, a
   network error). In the Android app, API answers that will not pass by
   waiting are told apart (`src/api-sample.ts`): a credit balance too low,
   a model the key cannot use (404), any other refused request.
   Once chords and structure are read, "TAB（リズム・フレット）を読む"
   reads the tab layer the same way (one tab line per measure, see
   `@guitarmr/extract`); measures whose beats do not add up or whose notes
   cannot be played are marked for review.
3. The score shows the read chords and signs over each measure, colored by
   state (unread, read by AI, needs attention, reviewed). Tapping a
   measure opens an editor with the measure image, chords, section start,
   bar lines and signs, the tab as a tab line with a running beat total,
   and what the checks found about the measure; "確認済みにして次へ"
   marks it reviewed. Where detection drew the measures wrong, the editor
   fixes them: "2つに分ける" then a tap on the measure image where the
   bar line is splits it, "次の小節とつなげる" joins it with its neighbor
   in the system, "この小節を消す" deletes it; a page that is not part of
   the score (a chord chart, a cover) is left out with "このページを外す"
   on its card and brought back with "このページを戻す". Measures are
   numbered in order again after each of these, what was read inside a
   changed measure is dropped (read it again). "元に戻す" undoes these
   and the fields typed in the sheet one by one (`@guitarmr/extract`
   edit.ts): in the notice at the top right after a change, in the
   sheet's head, and next to the review counts (also Ctrl/⌘+Z outside a
   text field).
   Above the save button, the checks across the score
   (repeats, endings, D.S./Coda, sections, and each measure's tab) are
   listed; tapping one opens its measure.
4. Save `<name>.gts.json`. The library on the device (`src/library.ts`,
   IndexedDB) keeps every opened PDF or set of photos together with the
   work on it; it is the score list, the first view: one card per score
   with its first page as the cover (`src/cover.ts`; made when the score is
   scanned, or from the stored files for older entries), where a score is
   opened again or deleted. The first scan of a score is kept with it
   (the upright page images as JPEG and what detection found, `scan` in
   the entry), so it opens again without scanning; a scan made by other
   detection code (the page names it by a hash of the detection scripts)
   is not used, and the score scans again. "スキャンし直す" on the score
   scans its files anew, and "キャッシュを消す" in the settings drops
   every stored scan; the work on a score stays either way. The scan is
   neither exported nor taken from an import. Nothing in it leaves the device. A saved gts
   file can also be opened again to continue. "別の端末へ引っ越す" writes
   the whole library to one `guitarmr-library-<date>.jsonl` file and
   takes such a file in on the new device (`src/transfer.ts`): the work
   on every score comes first and the PDFs and photos last, in chunks
   checked by SHA-256, so a file cut short or damaged still moves all the
   work. Moving devices is in the settings.
5. Play it (once Claude has read something; measures only found on the
   page would be empty bars): the play view (`src/player.ts`) shows the measures in play
   order (repeats, endings and D.S./D.C./Coda expanded by `playOrder` in
   `@guitarmr/gts`), each with its chords spread by duration, the verse
   for the current pass and chord diagrams from `chordShapes`. Playing
   follows the tempo with a one-measure count-in and an optional click
   (Web Audio, scheduled ahead) and the score's sound, chords and tab
   switched on their own (`soundEvents` in `@guitarmr/gts` times the
   chords, strummed where they change, and the tab notes with tuning and
   capo; `src/synth.ts` plucks them as Karplus-Strong strings); the current measure is highlighted and
   its beat marks fill in: 4, 8 or 16 per 4/4 measure (on-beat marks
   taller), from the song's `meta.beat` (default 4) or the 4/8/16 switch, and the view scrolls to keep the current line near the
   top. Measures per row and text sizes follow the screen and each
   measure's width (container query units), with A−/A＋ on top. Inside a
   measure the marks, chord and lyric lines have fixed heights, and a row
   shrinks long names as a whole, so chords and lyrics stay level across
   a row for the eye to follow. A score with tab shows it on six lines
   under the chords, each fret placed by its time in the measure
   (`tabBeats` in `@guitarmr/gts`); 表示 picks コード＋TAB, コード or TAB
   alone (remembered per device). 解説 (remembered per device) adds each
   chord's degree in the key under its name and a foldable panel
   (`src/explain.ts`) with the song's most telling progressions (ツーファイブ
   ワン, カデンツ, 王道・小室・カノン進行, secondary dominants, sus4
   resolutions…), what each does and where it is played; tapping one marks
   its measures and goes there. `songKey` and `progressions` in
   `@guitarmr/gts` do the analysis (the key as written, else estimated
   from the chords). A gts file
   can be opened in it on its own, without the PDF; the committed
   public-domain samples are built in and always listed after the user's scores,
   tagged サンプル (they cannot be deleted).

```sh
pnpm --filter @guitarmr/demo build              # dist/tky.html
pnpm --filter @guitarmr/demo build --no-samples # without the embedded samples
pnpm --filter @guitarmr/demo build:android      # dist/android/ for the Android app (ADR-010)
```

- `scripts/build.ts` concatenates the core (`gts`, `layoutscan`,
  `extract`) and the page modules with their types stripped (Node's
  `stripTypeScriptTypes`; no bundler), embeds the two public-domain sample
  PDFs generated by `@guitarmr/samples`, and loads pdf.js (legacy build,
  for current iOS Safari) from jsDelivr at the version pinned in
  `package.json`.
- `src/app.ts` runs the page, `src/router.ts` names the screens in the URL hash, `src/score-view.ts` draws the SVG layer over
  each page image, `src/editor.ts` is the measure editor and
  `src/reader.ts` cuts the images and calls Claude (`src/retry.ts` asks again after a lost connection). `src/photos.ts`
  decodes photos and runs the tray, `src/library.ts` is the library. `src/preview.ts` and
  `src/worker.ts` run in the worker (detection plus a 2400 px upright
  preview, kept as a JPEG).
- The page is in Japanese or English after the device's language
  (`navigator.languages`: Japanese when it comes first, English otherwise).
  `src/i18n.ts` holds the words: `page.html` is written in Japanese and
  marks its text with `data-i18n` / `data-i18n-html` /
  `data-i18n-<attribute>` keys whose English is in `PAGE_EN`; text made at
  run time comes from `MESSAGES`, handed to each module that shows it
  (`test/i18n.test.ts` keeps the keys and both languages complete). Song
  content (titles, lyrics) and the check messages written into a score's
  `review.comment` stay as they are.
- The output is a page body without `<html>`/`<head>`: it is published as
  a private claude.ai Artifact declaring the `downloads` and
  `sample` (with images) capabilities, which provide the save dialog and
  Claude. Opened from disk it detects and edits, saves by a plain
  download, and hides the Claude step.
- For the Android app (`android/`), `build:android` writes a whole
  document with pdf.js next to it and `src/android-host.ts` in front:
  it stands in for the claude.ai runtime, `sample` over the Claude API
  with the user's own key (`src/api-sample.ts`) and `downloads` through
  the app's save picker.

`pnpm test` checks that the concatenated core detects exactly like the
modules, that no top-level name is declared twice across the concatenated
files, and that the page only loads the pinned pdf.js and fonts.

## Local dev server

```sh
pnpm --filter @guitarmr/demo dev   # http://127.0.0.1:5173/
```

`scripts/dev.ts` serves the page and rebuilds it when a file under
`gts/src`, `layoutscan/src`, `extract/src`, `demo/src` or
`schemas/examples` changes; open tabs reload by themselves, and a build
error is shown in the page until it is fixed. Options: `--port <n>`,
`--host <addr>`, `--no-samples` (the sample PDFs are generated once at
start; restart after changing `@guitarmr/samples`). As when opened from
disk, the Claude step is hidden and pdf.js and fonts load from their CDNs.

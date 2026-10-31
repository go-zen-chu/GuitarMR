# @guitarmr/demo

A single HTML file that digitizes a scanned guitar score on a phone, as the
first step toward the phone/tablet PWA (ADR-009):

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
   from the corrected page.
   Once chords and structure are read, "TAB（リズム・フレット）を読む"
   reads the tab layer the same way (one tab line per measure, see
   `@guitarmr/extract`); measures whose beats do not add up or whose notes
   cannot be played are marked for review.
3. The score shows the read chords and signs over each measure, colored by
   state (unread, read by AI, needs attention, reviewed). Tapping a
   measure opens an editor with the measure image, chords, section start,
   bar lines and signs, the tab as a tab line with a running beat total,
   and what the checks found about the measure; "確認済みにして次へ"
   marks it reviewed. Above the save button, the checks across the score
   (repeats, endings, D.S./Coda, sections, and each measure's tab) are
   listed; tapping one opens its measure.
4. Save `<name>.gts.json`. The library on the device (`src/library.ts`,
   IndexedDB) keeps every opened PDF or set of photos together with the
   work on it; it is listed at the top of the page, where a score is
   opened again (analyzed again from the stored files, then the stored
   work restored) or deleted. Nothing in it leaves the device. A saved gts
   file can also be opened again to continue. "別の端末へ引っ越す" writes
   the whole library to one `guitarmr-library-<date>.jsonl` file and
   takes such a file in on the new device (`src/transfer.ts`): the work
   on every score comes first and the PDFs and photos last, in chunks
   checked by SHA-256, so a file cut short or damaged still moves all the
   work.
5. Play it: the play view (`src/player.ts`) shows the measures in play
   order (repeats, endings and D.S./D.C./Coda expanded by `playOrder` in
   `@guitarmr/gts`), each with its chords spread by duration, the verse
   for the current pass and chord diagrams from `chordShapes`. Playing
   follows the tempo with a one-measure count-in and an optional click
   (Web Audio, scheduled ahead); the current measure is highlighted and
   its beat marks fill in: 4, 8 or 16 per 4/4 measure (on-beat marks
   taller), from the song's `meta.beat` (default 4) or the 4/8/16 switch, and the view scrolls to keep the current line near the
   top. Measures per row and text sizes follow the screen and each
   measure's width (container query units), with A−/A＋ on top. Inside a
   measure the marks, chord and lyric lines have fixed heights, and a row
   shrinks long names as a whole, so chords and lyrics stay level across
   a row for the eye to follow. A gts file
   can be opened in it on its own, without the PDF; the committed
   public-domain samples are built in.

```sh
pnpm --filter @guitarmr/demo build              # dist/layoutscan-demo.html
pnpm --filter @guitarmr/demo build --no-samples # without the embedded samples
pnpm --filter @guitarmr/demo build:android      # dist/android/ for the Android app (ADR-010)
```

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

### From another device (Tailscale)

To check the page on a phone or another computer while the server runs on
this machine, put both on the same tailnet and let Tailscale proxy the
local port over HTTPS. HTTPS matters: browsers allow some APIs the page
uses (the clipboard copy) only in a secure context, which plain
`http://<tailscale-ip>` is not.

1. Install Tailscale on both devices and sign in to the same tailnet
   (`tailscale status` lists the devices).
2. Once per tailnet, enable **MagicDNS** and **HTTPS Certificates** in the
   admin console (DNS page); `tailscale serve` needs them for the
   `*.ts.net` certificate.
3. On this machine, start the server (it keeps listening on 127.0.0.1
   only, so nothing is exposed to the local network) and the proxy:

   ```sh
   pnpm --filter @guitarmr/demo dev
   tailscale serve --bg 5173
   ```

4. Open the URL printed by `tailscale serve` (`https://<machine>.<tailnet>.ts.net/`)
   on the other device. Saving a file on this machine reloads that tab too.
5. Stop the proxy when done: `tailscale serve reset`.

Without HTTPS certificates, `pnpm --filter @guitarmr/demo dev --host 0.0.0.0`
and `http://<tailscale-ip>:5173/` also work, except for the clipboard
copy; that listens on every interface, so only do it on a trusted network.

- `scripts/build.ts` concatenates the core (`gts`, `layoutscan`,
  `extract`) and the page modules with their types stripped (Node's
  `stripTypeScriptTypes`; no bundler), embeds the two public-domain sample
  PDFs generated by `@guitarmr/samples`, and loads pdf.js (legacy build,
  for current iOS Safari) from jsDelivr at the version pinned in
  `package.json`.
- `src/app.ts` runs the page, `src/score-view.ts` draws the SVG layer over
  each page image, `src/editor.ts` is the measure editor and
  `src/reader.ts` cuts the images and calls Claude. `src/photos.ts`
  decodes photos and runs the tray, `src/library.ts` is the library. `src/preview.ts` and
  `src/worker.ts` run in the worker (detection plus a 2400 px upright
  preview, kept as a JPEG).
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

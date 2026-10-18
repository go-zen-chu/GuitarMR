# @guitarmr/e2e

End-to-end tests of the built phone page (`packages/demo/dist`) in headless
Chromium, driven by `playwright-core` with Node's own test runner. The page
is served from a local URL, pdf.js requests to the CDN are answered from
the local `pdfjs-dist` package, web fonts are blocked, and claude.ai is
replaced by a fake that answers like Claude from a sample gts file, so the
tests need no network and no Claude account.

| File | What it checks |
| --- | --- |
| `test/detect.test.ts` | The built-in sample is analyzed on load (orientation, 15 measures), a sideways scan is turned upright, the file button picks PDFs and photos and refuses other files, nothing is wider than a phone; on a tablet the overlay sits on the page image without overflow |
| `test/photo.test.ts` | Two phone photos taken one by one go through the tray and are cut out, corrected and analyzed as one score (15 measures, the second page upside down, photo files and sheet corners in the gts file); photos picked out of order are reordered and removed in the tray; a photo with no score (what to retake, the photo shown, nothing kept); a PDF opened once comes back from the library after a reload with the work on it, and is deleted from it; only the work exported (no file data), a non-export refused, the same export taken twice (one score), the PDF bringing its files back; the library exported on one device and taken in on another (a fresh browser) with the photos' data damaged: both scores' work arrives, the PDF opens with its review, the photos' work plays and gets its files back when the photos are opened again |
| `test/review.test.ts` | Reading with the fake Claude (one request per page, header image first), the measure marked for review, a refused chord, an edit and a new section, the saved gts file (schema-valid, edits kept), the draft after a reload; the reading step stays hidden outside claude.ai; the tab read after the chords (one measure a beat short): marked for review and listed by the checks, a bad tab line refused, fixed with the running total, the checks cleared, a repeat start inside a repeat caught, the beats saved |
| `test/files.test.ts` | A dropped PDF, several PDFs picked (the first is analyzed), a broken PDF and one without TAB (said so, the page keeps working), a saved gts reopened (through either button; another PDF's gts and a non-gts file refused), saving outside claude.ai (a valid download) and a declined save dialog, copying the JSON (on the clipboard, or selected when refused), a gts file in the play view (and a wrong one refused), the score being worked on in the play view, a draft of an earlier version moved from localStorage to the library, blocked storage (the page works and says the work is not kept) |
| `test/reading.test.ts` | Stopping while page 2 is read (page 1 kept, only page 2 asked again), the usage limit (resumes), Claude not allowed (the step goes, hand review stays), an unreadable answer for one page (listed, the other page read, the header read with page 1 later), re-reading a page (its edits replaced, the other page's kept), walking the measures to review in order and around |
| `test/editor.test.ts` | Opening measures by tap, Enter, Space and the arrows across pages, Escape; chords with and without beat positions, a refused chord blocking "reviewed"; repeat end with count, endings, D.S. (caught without a segno, cleared by one), a repeat sign (no tab), back to a plain bar line; sections started, left by tapping the next measure (the tap must not get lost) and cleared; throwing the draft away, also after a reload |
| `test/player.test.ts` | Play order (28 measures for さくらさくら), measures per row on phone and tablet, chords and lyrics level across each row with one text size, 4/8/16 beat marks while playing, auto-scroll, tap to jump, D.S. al Coda and chord diagrams in dark mode |

```sh
pnpm --filter @guitarmr/demo build    # the page under test
CHROMIUM_PATH=/usr/bin/google-chrome pnpm --filter @guitarmr/e2e e2e
```

`CHROMIUM_PATH` points the tests at an installed Chrome or Chromium (CI
uses the runner's Google Chrome); without it, `playwright-core` looks for
its own download (`playwright-core install chromium`). Screenshots of each screen are written to
`.artifacts/` (or `E2E_ARTIFACTS`) for people to look at; they are not
compared. CI (`.github/workflows/web.yml`) runs type checks, unit tests,
the build and these tests on every change under `web/` or `schemas/`, and
uploads the screenshots and the built page.

# @guitarmr/e2e

End-to-end tests of the built phone page (`packages/demo/dist`) in headless
Chromium, driven by `playwright-core` with Node's own test runner. The page
is served from a local URL, pdf.js requests to the CDN are answered from
the local `pdfjs-dist` package, web fonts are blocked, and claude.ai is
replaced by a fake that answers like Claude from a sample gts file, so the
tests need no network and no Claude account.

| File | What it checks |
| --- | --- |
| `test/detect.test.ts` | The built-in sample is analyzed on load (orientation, 15 measures), a sideways scan is turned upright, the file button picks PDFs and refuses other files, nothing is wider than a phone |
| `test/review.test.ts` | Reading with the fake Claude (one request per page, header image first), the measure marked for review, a refused chord, an edit and a new section, the saved gts file (schema-valid, edits kept), the draft after a reload; the reading step stays hidden outside claude.ai |
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

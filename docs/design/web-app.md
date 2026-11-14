# Design Decisions: web and Android app (tky)

Decisions for digitizing and viewing scores on a phone or tablet: the gts
format, the phone page and the Android app wrapping it. Numbers are shared
with [mr.md](mr.md); see the [index](README.md).

## ADR-008: Canonical JSON format (gts, Guitar Tab Score) for digitized handwritten tabs

**Status**: Proposed (2026-09-25)

**Context**: The scores used for practice are handwritten tabs scanned to PDF
(no text layer, mixed page orientation, colored teacher annotations). To
enable features beyond showing the image (measure highlighting, auto page
turn, chord charts, playback), they need to be digitized. Recognition of
handwriting is imperfect, so the data must be reviewable against the scan and
may be only partially complete. Candidates were MusicXML, Guitar Pro,
alphaTex, ChordPro and a project-specific JSON format.

**Decision**: Define a project-specific JSON format, `gts` (Guitar Tab
Score), validated by `schemas/gts.schema.json`, as the canonical
representation. It stores
what is written on the page (capo-relative frets and chords, simile signs,
repeats and navigation in written order), the page region of every measure,
per-measure confidence/review status and, for personal use, lyrics per
verse. Degrees, barline-free chord sheets and colored pen comments are out
of scope for now. No
exporter is built for now; a one-way MusicXML export for other viewers is a
possible future addition (backlog). Full rationale, data model and the
recognition pipeline outline: [tab-digitization.md](tab-digitization.md).

**Consequences**:
- Partial data (only some of the layers: layout, structure, chords, tab, lyrics) is a valid
  document, so value is delivered before tab recognition is solved.
- Page regions let the app map playback position to the PDF it already
  renders, without re-engraving the score.
- The schema doubles as the structured-output contract for LLM-based
  extraction and as the validation gate.
- We own the review viewer instead of reusing an editor's native format;
  until a MusicXML exporter exists, the data is not viewable in other
  apps.
- Real transcriptions are copyrighted and stay out of the repository; they
  live next to the PDF as `<name>.gts.json`.

## ADR-009: Digitize and view on phone/tablet as a client-only PWA in TypeScript

**Status**: Accepted (2026-09-27)

**Context**: Digitizing handwritten scores (ADR-008) should be possible with
only a phone or tablet, while practice stays on the Quest 3 (MR). Scores
are copyrighted, so they should never be uploaded to a server we run.
Options were a web app processing files on the device, a native app
(Flutter etc.), or a server-side pipeline. For the web app, the detection
core could be TypeScript or Rust compiled to WebAssembly.

**Decision**:
- **Split**: the phone/tablet digitizes and views (score + detected
  measures + extracted layers); practice happens in the Quest app. The
  `.gts.json` file next to the PDF is the hand-off between them.
- **PWA, client-only**: a static site (installable, offline-capable) that
  opens a PDF from the device, runs every step in the browser (Web Worker)
  and saves results locally, exporting `song.gts.json` through the share
  sheet / download. No server of ours ever sees a score.
- **Input**: PDF, or camera photos (one per page; see the amendment of
  2026-10-17).
- **Users**: the author only for now. Distribution to others (a key relay
  server, store packaging) is in the backlog.
- **LLM steps**: the user's own Claude API key is stored on the device and
  the browser calls the Claude API directly (the API's direct browser
  access mode). Scores go only to Anthropic, under the user's own account.
- **One language, TypeScript**: the PWA, the detection core, the Node CLI
  and the sample/test tooling are all TypeScript in one workspace under
  `web/`. The detection core is a pure function over RGBA pixels, used by
  the browser worker and the CLI alike. The Python `tools/layoutscan` is
  ported and then retired; the committed public-domain samples guard that
  the port detects the same layout. (Done 2026-09-27: the port matched
  the Python version on every surveyed page and replaced it.)

**Consequences**:
- One codebase for iOS, Android and desktop, updated instantly, with no
  store review; Rust/WebAssembly stays an option for the detection core
  alone if a phone turns out too slow (it sits behind one function).
- Image processing (thresholding, line morphology, rotation) is written by
  hand instead of calling OpenCV; it only needs a few simple operations.
- iOS may evict site storage of rarely used web apps; installing to the
  home screen and requesting persistent storage mitigates it, and exported
  `.gts.json` files are the durable copy.
- The API key lives in the browser; acceptable for a single personal user,
  not for distribution (hence the relay server in the backlog).
- Dependencies are kept minimal to limit vulnerability maintenance: the PWA
  ships only pdf.js; tests use Node's built-in runner and scripts run with
  plain `node` (type stripping). The policy is in web/README.md.

**Amendment (2026-10-09)**: the first working version runs as a private
claude.ai Artifact (web/packages/demo), where a page cannot reach the
Anthropic API (its network is blocked). There, Claude is reached through
the Artifact's built-in Claude access instead of an API key: the page asks
on the viewer's own claude.ai account (the viewer approves it once), and
only the system images cut from the score are sent, never the PDF. The
API-key path stays the plan for the standalone PWA. The reader takes the
model call as a parameter (`readPages(sample, ...)`), so the standalone
PWA only adds the other backend.

**Amendment (2026-10-17)**: photos as input, and a library on the device.
- **Photos**: one photo per page, taken one by one with the camera or
  picked together, ordered in a tray and analyzed as one score. Since a
  score is dark ink on white paper, the sheet is the largest bright area
  of the photo: it is found there (thin ink closed over, convex hull
  reduced to four corners, sides refined by line fits), cut out with its
  perspective undone (the sheet's aspect ratio is solved from the
  perspective, falling back to a phone's usual focal length, and snapped
  to √2 for A/B paper) and its lighting flattened (paper brightness per
  channel divided out, which also removes a warm cast), all before
  detection (`correctPhoto` in `@guitarmr/layoutscan`, hand-written like
  the rest). Claude reads the systems cut from the corrected page. The gts
  file records each page's photo file and the sheet's corners in it
  (`source.pages[].file`, `.paper`), so regions can be mapped back to the
  photo; the score's `sha256` covers the photos in page order.
- **Library**: every PDF or set of photos opened is stored with the work on
  it (the gts document) in the browser's IndexedDB, so a score can be
  opened, re-analyzed and continued later without picking the files
  again, and nothing leaves the device. It replaces the localStorage
  drafts (moved over when found). Persistent storage is requested; saving
  `.gts.json` remains the durable copy.
- **Moving devices**: the library is exported as one JSON Lines file,
  written light to heavy (header, every score with its gts document, then
  the files in chunks of 768 KB, smallest file first, each file with its
  SHA-256, then an end mark). Import reads it line by line and skips what
  it cannot read; a score whose files do not arrive whole keeps its work
  and comes without files. The newer work wins when a score is already on
  the device. The file goes through the save dialog, like `.gts.json`, so
  it never passes a server of ours.

**Amendment (2026-11-02)**: the page is laid out as an app, **tky** (the
name of the Android app, ADR-010), with layout detection one feature in it.
- **Screens**: the score list (楽譜, the first view: the library with
  progress per score and the built-in play samples), scanning (スキャン:
  picking PDFs and photos, the photo tray, the scan samples) and one
  score (reading with Claude, checks, the measures, saving, playing).
  Settings sit behind a gear (moving devices, storage, a gts file in the
  play view, the Android app's API key). Two bottom tabs switch between
  the list and scanning; the score is opened from the list.
- **Flow**: a finished scan opens its score; one finished after the viewer
  went elsewhere waits in the list. The page no longer opens a sample on
  load.
- **Routing**: the screen is kept in the URL hash (`#/`, `#/scan`,
  `#/settings`, `#/score/<sha256>`), so the browser's back and a reload
  work; a score's address opens it from the library (or the built-in
  sample with that SHA-256). The Android back button asks the page
  (`tky.back()`): it closes the editor or the play view, then goes to the
  list, and on the list the app goes to the background.

## ADR-010: Ship the phone page as an Android app wrapping it in a WebView

**Status**: Accepted (2026-10-28)

**Context**: The phone page (ADR-009) runs as a claude.ai Artifact, whose
runtime provides reading with Claude (`sample`) and saving (`downloads`).
On an Android phone the author wants an installed app that updates itself
from GitHub, like go-zen-chu/ws: releases from `main`, and PR builds
installable for trying changes on the device. Options were a native
rewrite, a PWA, a wrapper framework (Capacitor), or a plain WebView app.

**Decision**: A plain Kotlin WebView app, **tky** (`xyz.amasuda.tky`, on
the author's domain), under `android/` with no libraries. The page is built for it (`build:android`: a whole document,
pdf.js bundled next to it) and served from the app's assets on
`https://appassets.androidplatform.net`. A small host script
(`android-host.ts`) stands in for the claude.ai runtime as
`globalThis.claude`, so the page itself stays the same:
- `sample` calls the Claude Messages API from the page with the user's own
  API key (the direct browser access mode of ADR-009); the key is kept in
  the app's private storage, asked for on the first reading and dropped
  when the API rejects it.
- `downloads` goes through Android's save picker; file inputs open the
  document picker, `capture` inputs the camera app.
- CI (`.github/workflows/android.yml`) signs every build with one release
  key from repository secrets. `main` publishes a GitHub Release; each PR
  publishes its preview app (another package id) as a prerelease, which
  Obtainium installs with prereleases turned on.

**Consequences**:
- One page for the Artifact and the app; app-only behavior is in the host
  script and the Kotlin bridge, both unit tested.
- The API key sits in the app's private storage and is visible to the
  page's script; only the bundled page runs in the WebView (other links
  open in the browser), and backups of the app data are turned off.
- Reading is billed to the user's API account instead of their claude.ai
  plan. The default model is set in `api-sample.ts`.
- Losing the signing key means installed apps cannot be updated in place,
  so it is backed up outside GitHub.


## ADR-011: Lower the cost of reading with Claude without lowering its quality

**Status**: Proposed (2026-11-09)

**Context**: In the Android app (ADR-010), reading is billed to the user's
API account: one request per page for structure and chords (`pagePrompt`)
and another for the tab (`tabPrompt`), on `claude-opus-5-5` ($4 / $20 per
million input / output tokens) at the default effort (`medium`; thinking
cannot be turned off on this model and is billed as output). A page is
estimated (not measured) at about 10k input tokens (the system images and
an instruction of about 1.5k tokens, about $0.04) and several thousand to
10k output tokens with thinking (about $0.1-0.2), so output likely costs
more than input. The claude.ai Artifact is not billed per token. A
specialized service was considered in place of Claude:
- General OCR (Google Vision, Azure Document Intelligence): reads text,
  but not which measure and beat a chord belongs to, repeats, voltas or
  navigation signs, and is weak on handwritten chord names (a small sharp
  above the root, △7 against o7). An LLM would still be needed after it.
- Optical music recognition (Audiveris etc.): made for printed staff
  notation; handwritten TAB and chord names are mostly out of reach.
- Either sends the score to one more service, against ADR-009 (scores go
  only to Anthropic).

**Decision**: Keep reading with Claude, and lower its cost with the levers
below, each kept only when an eval shows no loss of quality:
- **Eval first**: a few pages of the author's own scores with hand-checked
  `.gts.json` files as the answer, scored as the per-measure match of
  chords and signs (and tab digits for the tab pass). The scores and
  answers stay out of the repository (ADR-008). Every run is billed.
- **Cheaper model, with Opus where unsure**: read every page with
  `claude-haiku-5-5` ($0.10 / $0.50, about 1/40 of Opus) or
  `claude-sonnet-5-5` ($2 / $10), and read again with Opus only the
  systems whose measures come back below a `confidence` threshold (the
  prompt already asks for it). Compared against Opus at `low` effort, the
  simpler option.
- **Effort**: set `output_config.effort` to `low` and measure, since
  thinking is likely the largest part of the bill.
- **Structured outputs**: give the reply's JSON schema in
  `output_config.format`, so no request is lost to `invalid_json` and
  `jsonOfReply` no longer needs to cut JSON out of prose.
- **Batch API** (50% off): only for reading that can wait (results take
  minutes, at most 24 hours); whether it can be called from the page
  (CORS) is to be checked.
- **Smaller images**: image tokens grow with area (about width × height /
  750), so crops are cut to the lowest resolution that still reads, and
  the faded margins of the neighboring systems kept thin.
- **Prompt caching**: move the fixed instruction into `system`, before the
  images, so it can be cached. Small gain: the instruction may be below
  the model's minimum cacheable length.

**Consequences**:
- The score keeps going only to Anthropic; no new service or key.
- A cheaper default needs the eval and real usage numbers (`usage` of the
  responses) before it replaces Opus; until then the default in
  `api-sample.ts` stays.
- A two-model reading adds a second pass to `readPages` and a threshold to
  tune; a batch reading changes the flow from waiting on the page to
  results arriving later.

**Update (2026-11-14)**: Before any lever above, a failure that wasted
money was fixed: a page of tab could be cut off at the reply's token cap
and lost while still billed. The request shape, how a reading is split
into requests and how its cost is shown are now decided in ADR-012.

## ADR-012: How the app calls the Claude API, and what a reading may spend

**Status**: Accepted (2026-11-14)

**Context**: In the Android app (ADR-010) every request to the Messages
API is billed to the user's own key, so the shape of a request, how a
reading is split into requests, and what happens on a failure decide what
a scan costs. A scan of a few pages cost about $0.5 and many measures came
back empty, while Claude Code reading the same scan did well. Looking at
`api-sample.ts` and `reader.ts` showed:
- A reply is capped at `max_tokens` (16k), and on `claude-opus-5-5`
  thinking cannot be turned off and counts toward that cap. The tab pass
  asked for a whole page (up to 20 systems) in one reply, so its thinking
  and its tab lines could run past the cap.
- `stop_reason: "max_tokens"` was not checked: the cut reply was taken
  for `invalid_json`, every measure of the page stayed empty, and the
  16k output tokens (about $0.32 at $20 per million) were billed anyway.
  This alone can make up most of the $0.5.
- Nothing recorded the responses' `usage`, so the cost was only a guess
  (ADR-011 estimates, never measured).

**Decision**:
- **Request shape** (`api-sample.ts`): `model`, `max_tokens` 16000 and one
  user turn with the images before the instruction text; nothing else. No
  `thinking`, `output_config.effort` or `output_config.format` is sent, so
  the model runs at its defaults (on `claude-opus-5-5`: adaptive thinking,
  effort `medium`). Each of those changes the bill or the quality, so each
  is added only through ADR-011's eval and recorded here.
- **The SDK is not used**: the page calls the API with `fetch` (ADR-009:
  the browser calls the API directly, no dependency or server of ours).
- **Requests per reading** (`reader.ts`): the structure pass (chords and
  signs, short answers) sends one request per page, with up to the image
  limit of systems, and the page top first on the first page. The tab pass
  sends one system per request (`TAB_SYSTEMS_PER_REQUEST`): a system's tab
  and its thinking fit well under the cap, a failure loses one system
  rather than a page, and Claude looks at one line of TAB at a time. The
  images are not sent more often than before; only the instruction (about
  1.5k input tokens, about $0.006) is repeated per system.
- **Failures**: a reply stopped at the cap fails as `truncated`, a page
  warning, and the reading goes on. A billed failure (`truncated`,
  `refused`, `invalid_json`) is never asked again automatically: asking
  again bills again and is likely to fail the same way. Only failures the
  API does not bill and that pass on their own (a lost connection, an
  overloaded service) are asked again (`retry.ts`). A refused key, an
  empty balance or a reached rate limit stops the reading at once, with no
  further request.
- **The cost is shown**: the API sample adds up `usage` of every billed
  reply, the cut-off and refused ones included, and prices it from
  `PRICES` (USD per million tokens, from Anthropic's price list). After a
  reading the status line tells its requests, input and output tokens and
  about how much it cost. A model missing from `PRICES` shows tokens only.
  On claude.ai (not billed per token) nothing is shown.
- **Contract tests**: `test/api-contract.test.ts` pins the request
  (headers, the exact body keys, `max_tokens`, the order of images and
  text), how each kind of answer in `test/testdata/messages/` (taken from
  the API's documented shapes) is taken and counted, and the `Sample`
  contract the reader relies on, run against every implementation on the
  API (the API sample, the Android app's host, and both with `withRetries`):
  answers parse, failures carry string codes, a billed failure is sent
  once, and the spent totals never go down. `test/reader.test.ts` pins how
  many requests and images a reading sends. A change to any of these is a
  change to what a reading costs: it updates those tests and this ADR
  together.

**Consequences**:
- A cut-off reply costs one system, not a page, and says so.
- A tab reading sends as many requests as there are systems: more,
  smaller requests. Latency per page grows; per-request overhead is the
  repeated instruction only.
- The shown cost gives the measured numbers ADR-011's levers are to be
  judged by. `PRICES` must be kept in step with Anthropic's price list
  when a model is added or its price changes.
- Requests are still one at a time; sending a page's systems in parallel
  would be faster, at the risk of the rate limit.

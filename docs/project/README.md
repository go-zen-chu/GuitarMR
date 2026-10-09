# Project Notes

Backlog and known issues for GuitarMR. Move items to GitHub Issues once the
project starts taking external contributions.

## TODO (feature backlog)

- [ ] **Photo input (camera / image files)** alongside PDFs, in two steps.
      The detector already takes plain RGBA pixels, so only the input and
      the photo-specific distortions are new.
      1. *Image files* (small): accept JPEG/PNG (iOS hands camera photos to
         a file input as JPEG) and decode them with the platform
         (`createImageBitmap` in the browser, `@napi-rs/canvas` in Node;
         no new dependency). Each image becomes one page; the gts `source`
         needs a per-page file name (e.g. `source.pages[].file`). Works as
         is for flat, frame-filling photos and document-scanner output.
      2. *Photo correction* (medium): before detection, find the paper
         outline (largest bright quadrilateral), undo the perspective with
         a 4-point homography, and flatten uneven lighting (divide by a
         blurred background), all hand-written like the rest of
         layoutscan. Record the paper corners per page so regions map back
         to the original photo. Test fixtures: the sample engraver plus a
         simulated photo (perspective, shading, background around the
         page), then a few real photos checked by eye.
- [x] **Score file picker**: done — left Menu button opens an in-app picker
      listing PDFs from Download/Documents (ADR-007); the legacy adb-push
      path was removed.
- [ ] **Selectable time signatures**: beats per bar is fixed to 4/4;
      `BeatClock` already supports any `beatsPerBar`, only input/UI is missing.
- [ ] **Tap tempo**: set the BPM by tapping a controller button.
- [ ] **Auto page turn / scroll**: advance the score in sync with the
      metronome given a tempo-to-bars mapping.
- [ ] **Hand tracking**: page turning and metronome control via pinch
      gestures so both hands can stay on the guitar.
- [ ] **Panel grab-and-move**: reposition/resize panels with the grip button
      instead of only recentering.
- [ ] **Practice statistics**: log practice time per song/tempo (Info-level
      structured logs first, UI later).
- [ ] **A-B loop count-in**: count-in bar before the metronome starts.
- [ ] **Handwritten tab digitization** (ADR-008, docs/design/tab-digitization.md):
      format, the `layout` layer (web/packages/layoutscan), and reading
      the `structure`/`chords` layers with Claude plus the review editor
      (web/packages/extract, web/packages/demo) are done. Next:
      - Check the reading on the real scores and tune the prompt from
        the misses (measure ids, beat positions, repeats/D.S.).
      - Merge and split measures in the review editor: layout misses on
        real scores are about 1 in 50 measures (an oval around a stacked
        chord taken as a bar line, a faint bar line missed), and today
        they can only be fixed by hand in the JSON.
      - `tab` layer: rhythm and frets per measure, with beat-sum and
        string/fret validators feeding `needs-attention`.
      - Semantic checks across measures: repeat/volta balance, sections.
      - Loading the sidecar `.gts.json` in the Quest app.
- [ ] **MusicXML export for gts**: one-way converter so digitized scores
      open in MuseScore / Guitar Pro and other viewers (the `tab` layer as
      tab, otherwise chord symbols over slashes). Not needed yet (ADR-008).
- [ ] **gts: `lyrics` layer extraction** (personal use only): the format
      is done (`measures[].lyrics[{verse, text}]`, see the sakura-sakura
      sample); the extraction tool is not. Preferred input: paste the
      correct lyrics text and let an LLM assign lines to measures by
      looking at the measure crops (no handwriting OCR); reading lyrics from
      the scan is the fallback. Lyrics are copyrighted: fine as a private sidecar
      `.gts.json` next to the PDF, never committed or shared (`*.gts.json`
      is git-ignored).
- [ ] **gts: extract more of the page**: Roman numeral degrees,
      barline-free printed chord sheets and colored pen comments are left
      out of the format for now (sketches in docs/design/tab-digitization.md,
      "Out of scope for now").
- [ ] **Phone/tablet PWA** (ADR-009): the TypeScript workspace under
      `web/` exists and layoutscan is ported (Python version retired). A
      single-file demo (web/packages/demo) already runs as a claude.ai
      Artifact: PDF import, detection in a Web Worker, reading chords and
      structure with Claude on the viewer's claude.ai account, the review
      editor, drafts in the browser, `.gts.json` save and reopen. Next are
      the installable PWA shell (offline, local library) and its Claude
      backend with the user's own API key (the Artifact cannot reach the
      API directly).
- [ ] **PWA: distribution to other users**: a small relay server so no API
      key sits in the browser (it must not store scores), and optionally a
      store-packaged wrapper (e.g. Capacitor) if iOS storage or file
      integration proves insufficient.
- [ ] **CI**: run EditMode tests headless on GitHub Actions
      (needs a Unity license secret, e.g. game-ci/unity-test-runner).

## Known issues / risks

- **Package versions are tied to the editor version**: the manifest pins the
  versions bundled as defaults with Unity 6000.5.2f1 (Input System 1.19.0,
  AR Foundation 6.5.0, Meta OpenXR 2.5.0, OpenXR 1.17.1), verified by a
  headless test run. Moving to another editor stream means realigning them
  (older pins failed to compile on 6000.5, e.g. Input System 1.11 uses a
  removed TreeView API; `com.unity.modules.vr` no longer exists).
- **Android Build Support may be missing locally**: headless EditMode tests
  run without it, but building the APK requires adding the module (with
  OpenJDK and SDK/NDK) to the 6000.5.2f1 install in Unity Hub.
- **First editor open is required before building**: the project ships
  without `ProjectSettings.asset`; Unity generates defaults and
  `GuitarMR > Configure Project For Quest 3` fills in the Quest-specific
  settings. Building without running the configurator will produce a
  non-XR APK.
- **OpenXR feature enabling relies on type-name matching**:
  `ProjectConfigurator` enables features whose type name contains "Meta" or
  "OculusTouchControllerProfile" to stay robust across package versions. If a
  future package renames types, features must be enabled manually in
  Project Settings > XR Plug-in Management > OpenXR.
- **PDF rendering quality is fixed**: pages render at 1536 px width, capped
  at 60 pages. Very dense scores may need a higher resolution (increase
  `TargetPageWidthPixels` in `AndroidPdfScoreSource`, at the cost of memory:
  ~8.5 MB per page at 1536x2172 RGBA32).
- **"All files access" grant flow is device-dependent**: the picker deep-links
  to the system settings screen (`MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`).
  If a future Horizon OS build changes that screen, the fallback global
  settings intent is used; worst case, grant the permission manually under
  Settings > Apps > GuitarMR. A SAF-based picker is the designed fallback
  (ADR-007).
- **Editor play mode has no XR input**: without a headset the panels render
  but controller events never fire; domain behavior is covered by EditMode
  tests instead (see docs/development for the verification matrix).
- **Passthrough requires device testing**: passthrough cannot be verified in
  the editor; the camera simply renders a black background there.

## Decisions pending

- Whether to add TextMesh Pro for crisper label text (ADR-006 chose the
  built-in font to stay asset-free).
- Whether to migrate input to the XR Interaction Toolkit if in-world buttons
  become necessary (ADR-005).

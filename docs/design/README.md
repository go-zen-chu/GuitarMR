# Design Decisions

This document records the design decisions made for GuitarMR and the
reasoning behind them, in ADR (Architecture Decision Record) style.

## ADR-001: Use Unity official packages only, not the Meta XR SDK

**Status**: Accepted (2026-07-06)

**Context**: Quest 3 passthrough can be implemented either with the Meta XR
Core SDK (Asset Store package) or with Unity's official OpenXR stack
(`com.unity.xr.openxr` + `com.unity.xr.arfoundation` + `com.unity.xr.meta-openxr`).

**Decision**: Use the Unity official OpenXR stack.

**Consequences**:
- Fewer external dependencies; all packages resolve from the Unity registry
  with no Asset Store download or scoped registry setup.
- Version upgrades follow Unity's LTS cadence, reducing the risk of breaking
  changes from a third-party SDK.
- Some Meta-specific features (e.g. advanced passthrough styling, spatial
  anchors sharing) are unavailable, but none are needed for this app.
- Passthrough is driven by AR Foundation's `ARCameraManager` + `ARSession`
  with the camera clear color set to transparent black.

## ADR-002: Render PDFs on-device with the Android platform API

**Status**: Accepted (2026-07-06)

**Context**: Unity cannot display PDFs natively. Options considered:
1. Require users to convert PDFs to images before transferring them.
2. Bundle a third-party PDF rendering library.
3. Use Android's built-in `android.graphics.pdf.PdfRenderer` (API 21+) via JNI.

**Decision**: Option 3, with option 1 kept as a fallback (PNG/JPG pages are
loaded when no PDF is found; also used in the editor where JNI is unavailable).

**Amendment (2026-07-08)**: the image fallback (option 1) and the adb-push
workflow into the app-private folder were removed once the in-app picker
(ADR-007) made shared storage the single source of scores.

**Consequences**:
- Users transfer a PDF as-is; no conversion step.
- No external library dependency; the standard platform API is stable.
- JNI marshalling code is verbose, so it is isolated in
  `Infra/AndroidPdfDocumentRenderer` behind the `IScoreDocumentRenderer`
  interface.
- Explicit `Rect`/`Matrix` arguments are passed to `Page.render` because
  Unity's JNI helper cannot resolve Java method overloads from C# `null`.
- Pages are rendered once at startup at a fixed 1536 px width (readable at
  ~0.6 m panel width) and capped at 60 pages to bound memory use.

## ADR-003: Schedule metronome clicks on the audio DSP clock

**Status**: Accepted (2026-07-06)

**Context**: A metronome driven by `Update()`/frame time drifts and jitters
with the frame rate (72–120 Hz on Quest), which is unacceptable for rhythm
practice.

**Decision**: Compute beat times on `AudioSettings.dspTime` and queue clicks
with `AudioSource.PlayScheduled` inside a small lookahead window (0.2 s),
using two rotating `AudioSource`s so consecutive clicks never cut each other
off. Click sounds are generated procedurally (decaying sine bursts, higher
pitch on beat 1) so no audio assets are required.

**Consequences**:
- Sample-accurate timing independent of the frame rate.
- Tempo changes rebase the beat anchor (`BeatClock.SetBpm`) so already elapsed
  beats keep their times and the next beat comes one new interval later.
- The beat math lives in the pure `Domain/BeatClock` class and is unit tested.

## ADR-004: Layered architecture with runtime scene composition

**Status**: Accepted (2026-07-06)

**Context**: Unity scenes and prefabs serialize object wiring into YAML, which
is hard to review, merge and test. The project design principles require
constructor-based dependency injection and separation of I/O from business
logic.

**Decision**: Keep the scene minimal (a single `AppBootstrap` component) and
compose everything at runtime:

```
Domain/   Pure C# logic, no UnityEngine dependency (BeatClock, ScoreBook)
Usecase/  PracticeController + ports (IMetronome, IScoreRepository, IScoreDocumentRenderer, views, ...)
Infra/    Implementations touching I/O: audio, JNI, file system, XR input
App/      Composition root (AppBootstrap), world-space UI panels
Editor/   Project configuration and build automation
```

**Consequences**:
- All dependencies are explicit: plain classes use constructor injection;
  MonoBehaviours (which cannot have constructors) use an `Initialize` method.
- Domain and use case logic is testable without a headset or play mode.
- Scene diffs stay trivial; UI layout changes are reviewable C# code.
- Trade-off: no visual editing of the UI in the Unity editor.

## ADR-005: Controller-button input instead of ray/poke UI interaction

**Status**: Accepted (2026-07-06)

**Context**: Interactive world-space UI on Quest requires the XR Interaction
Toolkit (ray interactors, input action assets, event system wiring), which
adds a large dependency for a handful of actions.

**Decision**: Map all actions to controller buttons polled through the
standard `UnityEngine.XR.InputDevices` API (A/B: page turn, X: metronome
start/stop, Y: recenter, right stick: BPM). Panels are display-only.

**Consequences**:
- No XRI dependency, no input action assets, trivially testable edge
  detection.
- Both hands stay near the guitar; buttons are usable without aiming a ray.
- Trade-off: no in-world buttons for users who prefer pointing; revisit if
  hand tracking support is added (see docs/project).

## ADR-006: Use the legacy built-in font UI text

**Status**: Accepted (2026-07-06)

**Context**: TextMesh Pro renders crisper text but requires importing the TMP
Essentials assets and font asset generation, which conflicts with the
code-only, asset-free project setup.

**Decision**: Use `UnityEngine.UI.Text` with the built-in `LegacyRuntime.ttf`
font.

**Consequences**:
- Zero assets to import; panels are fully code-generated.
- Slightly softer text rendering; acceptable for labels and hints. The score
  itself is a texture, so readability of the music is unaffected.

## ADR-007: In-app score picker using "all files access"

**Status**: Accepted (2026-07-06), supersedes the adb-push-only flow

**Context**: Requiring `adb push` to transfer scores is developer-centric.
Players should download a PDF with the headset browser (lands in `Download`)
or drop it there over USB, then pick it in-app. Under Android scoped storage
(11+, Quest 3 is Android 12L), reading non-media files like PDFs owned by
other apps is impossible with `READ_EXTERNAL_STORAGE` alone. Options:
1. Storage Access Framework (`ACTION_OPEN_DOCUMENT`) system picker — the
   proper scoped-storage citizen, but launching 2D system activities from a
   VR process is unreliable on Quest.
2. `MANAGE_EXTERNAL_STORAGE` ("all files access") — one-time grant in the
   system settings, then plain file paths work; common among sideloaded
   Quest apps, but not allowed for Play Store listing (irrelevant here).
3. Target SDK 29 + `requestLegacyExternalStorage` — conflicts with the
   platform requirements of Horizon OS.

**Decision**: Option 2. The picker (left Menu button) lists PDFs from
`Download` and `Documents`; on missing permission it deep-links to the
system "all files access" screen for this app. The permissions are injected
into the generated manifest by an `IPostGenerateGradleAndroidProject`
post-processor.

**Amendment (2026-07-08)**: the legacy adb-push path (app-private `Scores`
folder scanning and the PNG/JPG fallback) was removed; shared storage via
this picker is now the only way scores enter the app.

**Consequences**:
- No PC or adb required: browser download → Menu → pick → play.
- One extra first-run step (granting file access in a system panel).
- The app must rescan the library on `OnApplicationFocus(true)` because the
  grant happens outside the app.
- The last selection is persisted (PlayerPrefs) and reloaded on launch.
- Controller input became modal: while the picker is open, the right-hand
  controls navigate the list. The modality lives in `PracticeController`,
  keeping `XrControllerInput` a dumb button poller.
- Should Meta ever reject the permission for store distribution, fall back
  to SAF (option 1) behind the same `IScoreRepository`/`IStoragePermission`
  ports.

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
- **Input**: PDF only. Camera capture is in the backlog.
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
  the port detects the same layout.

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

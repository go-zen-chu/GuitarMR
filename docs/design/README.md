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

**Consequences**:
- Users push a PDF as-is with `adb push`; no conversion step.
- No external library dependency; the standard platform API is stable.
- JNI marshalling code is verbose, so it is isolated in
  `Infra/AndroidPdfScoreSource` behind the `IScoreSource` interface.
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
Usecase/  PracticeController + ports (IMetronome, IScoreSource, IScoreView, IMetronomeView)
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

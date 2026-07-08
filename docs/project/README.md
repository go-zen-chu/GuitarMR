# Project Notes

Backlog and known issues for GuitarMR. Move items to GitHub Issues once the
project starts taking external contributions.

## TODO (feature backlog)

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
- [ ] **CI**: run EditMode tests headless on GitHub Actions
      (needs a Unity license secret, e.g. game-ci/unity-test-runner).

## Known issues / risks

- **Package versions are pinned optimistically**: `Packages/manifest.json`
  pins versions (AR Foundation 6.0.4, Meta OpenXR 2.0.1, OpenXR 1.13.0) that
  were not verified against the registry from this machine. If resolution
  fails on first open, align versions in the Package Manager and update the
  manifest.
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

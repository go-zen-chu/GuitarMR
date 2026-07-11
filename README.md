# GuitarMR

A guitar practice app for Meta Quest 3. It shows your sheet music (PDF) and a
metronome floating in front of you while XR passthrough keeps the real world —
and your guitar — fully visible.

Built with Unity official packages only (OpenXR + AR Foundation + Unity OpenXR
Meta); no Meta XR SDK dependency. PDFs are rendered on-device through the
Android platform API, so no offline conversion is needed.

## Documentation

- [docs/design](docs/design/README.md) — architecture and design decision records (ADRs)
- [docs/usage](docs/usage/README.md) — how to use the app on the headset
- [docs/development](docs/development/README.md) — setup, build and verification steps
- [docs/project](docs/project/README.md) — feature backlog and known issues

## Features

- XR passthrough on Quest 3: play while seeing your real guitar and room
- Sheet music panel: renders PDFs on-device; pick any PDF from the headset
  storage (browser downloads, USB copies) with the in-app score picker
- Metronome: sample-accurate clicks scheduled on the audio DSP clock,
  procedurally generated sounds (accent on beat 1), 30–300 BPM, beat indicator
- Controller-driven: score picking, page turning, tempo, start/stop and
  panel recentering

## Controls

| Input | Action | While picker is open |
| --- | --- | --- |
| Right controller A | Next page | Load highlighted score |
| Right controller B | Previous page | Close picker |
| Right thumbstick up / down | BPM +5 / -5 | Move highlight |
| Left controller X | Start / stop metronome | — |
| Left controller Y | Recenter panels | Recenter panels |
| Left controller Menu (☰) | Open score picker | Close picker |

## Requirements

- Unity 6000.5.2f1 (pinned in `ProjectSettings/ProjectVersion.txt`; other
  6000.x versions may need the package versions in `Packages/manifest.json`
  realigned) with the **Android Build Support** module (including OpenJDK and
  Android SDK/NDK) installed via Unity Hub
- Meta Quest 3 with developer mode enabled
- `adb` (bundled with the Unity Android module, or via Android platform tools)

## Setup and build

1. Open the project folder with Unity Hub. Unity resolves the packages on
   first open (this can take a few minutes).
2. Switch the platform to Android: `File > Build Profiles > Android > Switch Platform`.
3. Run the menu item `GuitarMR > Configure Project For Quest 3`.
   This sets the Android player settings (IL2CPP, ARM64, Vulkan, Linear color
   space), assigns the OpenXR loader, enables the Meta Quest OpenXR features
   (passthrough, session, touch controller profile) and registers the main
   scene. Restart the editor if it asks to switch the input handler.
4. Run `GuitarMR > Build Android APK`. The APK is written to `Builds/GuitarMR.apk`.
5. Install it on the headset:

   ```sh
   adb install -r Builds/GuitarMR.apk
   ```

If step 3 logs a warning about OpenXR settings not being found, open
`Project Settings > XR Plug-in Management > OpenXR` once and rerun the menu.

## Putting your sheet music on the device

Get a PDF into the headset's shared storage — no PC tooling required:

- download it with the **headset browser** (lands in `Download`), or
- connect the headset to a PC over USB and **drag & drop** it into
  `Download` or `Documents`.

Then press the left controller **Menu** button in the app and pick it from
the list. On first use the picker sends you to the system settings to grant
**"Allow management of all files"** (required to read PDFs from shared
storage under Android scoped storage; see docs/design ADR-007). The last
selected score is remembered across sessions.

PDF rendering only works on the device because it uses the Android
`PdfRenderer` API; in editor play mode the panels and the no-score guidance
can still be smoke-tested.

## Architecture

Everything in the scene is composed at runtime by `AppBootstrap` (the single
component in `Assets/Scenes/Main.unity`), with dependencies injected through
interfaces:

```
Assets/Scripts/
├── Domain/    Pure logic, no engine dependency (BeatClock, ScoreBook, ScoreCatalog)
├── Usecase/   PracticeController + ports (IMetronome, IScoreRepository,
│              IScoreDocumentRenderer, IStoragePermission, views, ...)
├── Infra/     AudioMetronome (DSP-scheduled clicks), AndroidPdfDocumentRenderer (JNI),
│              SharedStorageScoreRepository, StoragePermission,
│              PlayerPrefsScoreSelectionStore, XrControllerInput
├── App/       AppBootstrap (composition root), ScorePanel, MetronomePanel,
│              ScorePickerPanel, UiFactory
└── Editor/    ProjectConfigurator (Quest settings + APK build menu items),
               AndroidManifestPostProcessor (storage permissions)
```

## Testing

Domain and use case logic (including the modal controller input routing) is
covered by BDD-style EditMode tests (`Assets/Tests/EditMode`). Run them
headless — no device needed:

```sh
./scripts/run-editmode-tests.sh
```

The script prints the pass/fail counts and exits non-zero on compile errors
or failures. The suite is also available interactively via
`Window > General > Test Runner`.

## TODO

- Selectable time signatures (currently fixed to 4/4)
- Score file picker for multiple PDFs
- Hand-tracking / ray interaction as an alternative to controller buttons
- Auto page scroll synced to the metronome

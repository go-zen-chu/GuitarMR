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
- Sheet music panel: renders each page of a PDF placed on the device
- Metronome: sample-accurate clicks scheduled on the audio DSP clock,
  procedurally generated sounds (accent on beat 1), 30–300 BPM, beat indicator
- Controller-driven: page turning, tempo, start/stop and panel recentering

## Controls

| Input | Action |
| --- | --- |
| Right controller A | Next page |
| Right controller B | Previous page |
| Right thumbstick up / down | BPM +5 / -5 |
| Left controller X | Start / stop metronome |
| Left controller Y | Recenter panels in front of you |

## Requirements

- Unity 6000.0 LTS (any 6000.0.x) with the **Android Build Support** module
  (including OpenJDK and Android SDK/NDK) installed via Unity Hub
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

Launch the app once so it creates its data directory, then push your PDF:

```sh
adb push your-score.pdf /sdcard/Android/data/com.gozenchu.guitarmr/files/Scores/
```

Restart the app and the first PDF (alphabetically) in the folder is rendered.
PNG/JPG page images in the same folder work as a fallback when no PDF exists
(sorted by file name, one image per page).

In the editor, `GuitarMR > Open Scores Folder (Editor)` opens the local folder
used in play mode; drop PNG/JPG pages there to test (PDF rendering only works
on the device because it uses the Android `PdfRenderer` API).

## Architecture

Everything in the scene is composed at runtime by `AppBootstrap` (the single
component in `Assets/Scenes/Main.unity`), with dependencies injected through
interfaces:

```
Assets/Scripts/
├── Domain/    Pure logic, no engine dependency (BeatClock, ScoreBook)
├── Usecase/   PracticeController + ports (IMetronome, IScoreSource, views)
├── Infra/     AudioMetronome (DSP-scheduled clicks), AndroidPdfScoreSource (JNI),
│              ImageFolderScoreSource, CompositeScoreSource, XrControllerInput
├── App/       AppBootstrap (composition root), ScorePanel, MetronomePanel, UiFactory
└── Editor/    ProjectConfigurator (Quest settings + APK build menu items)
```

## Testing

Domain logic is covered by BDD-style EditMode tests
(`Assets/Tests/EditMode`). Run them via `Window > General > Test Runner`
in the editor, or headless:

```sh
Unity -batchmode -projectPath . -runTests -testPlatform EditMode -logFile -
```

## TODO

- Selectable time signatures (currently fixed to 4/4)
- Score file picker for multiple PDFs
- Hand-tracking / ray interaction as an alternative to controller buttons
- Auto page scroll synced to the metronome

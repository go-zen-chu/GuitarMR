# Development Guide

Setup, build and verification steps for GuitarMR contributors.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Unity Hub | 3.x | https://unity.com/download |
| Unity Editor | 6000.5.2f1 | Install via Unity Hub; pinned in `ProjectSettings/ProjectVersion.txt` |
| Android Build Support | bundled with the editor | Check **OpenJDK** and **Android SDK & NDK Tools** in the Hub install dialog |
| adb | any recent | Bundled with the Unity Android module; or `brew install android-platform-tools` |
| Meta Quest 3 | Horizon OS (Android 12L+) | Developer mode enabled via the Meta Horizon mobile app |

## Initial setup

1. Clone the repository and open the folder with Unity Hub.
   The first open resolves packages and imports assets (several minutes).
   If package resolution fails, see "Known issues" in docs/project.
2. Switch the platform: `File > Build Profiles > Android > Switch Platform`.
3. Run `GuitarMR > Configure Project For Quest 3` from the menu bar. This:
   - sets the Android player settings (IL2CPP, ARM64, min SDK 32, Vulkan,
     Linear color space, ASTC, package id `com.gozenchu.guitarmr`),
   - creates the XR settings asset and assigns the OpenXR loader for Android,
   - enables the Meta OpenXR features (passthrough camera, session, Quest
     support) and the Oculus Touch interaction profile,
   - registers `Assets/Scenes/Main.unity` in the build settings,
   - switches the active input handler to the Input System package.
4. Restart the editor if prompted (input handler change requires it).
5. If the console warned that OpenXR settings were not found, open
   `Project Settings > XR Plug-in Management > OpenXR` once and rerun step 3.

## Building and installing

```text
Editor menu: GuitarMR > Build Android APK   ->  Builds/GuitarMR.apk
```

```sh
adb install -r Builds/GuitarMR.apk
adb shell am start -n com.gozenchu.guitarmr/com.unity3d.player.UnityPlayerActivity
```

The first IL2CPP build takes a while; subsequent builds are incremental.
During the build, `AndroidManifestPostProcessor` injects the storage
permissions (`MANAGE_EXTERNAL_STORAGE`, `READ_EXTERNAL_STORAGE`) into the
generated manifest; no manual manifest editing is needed.

## Verification

### 1. Unit tests (no device required, scriptable)

```sh
./scripts/run-editmode-tests.sh
```

The script runs the whole EditMode suite headless with the pinned Unity
version, prints the pass/fail counts, and exits non-zero on compile errors or
test failures — suitable for humans, CI and AI agents alike. Results land in
`Logs/editmode-results.xml`, the full editor log in `Logs/editmode-tests.log`.
The same suite is available interactively via
`Window > General > Test Runner > EditMode`.

The tests cover the metronome timing math (`BeatClock`), page navigation
(`ScoreBook`), picker highlighting (`ScoreCatalog`) and the whole practice
flow including modal input routing (`PracticeControllerTests`, all ports
faked). The use case layer is engine-independent by design (pages cross the
boundary as the opaque `IScorePage`), which is what makes this coverage
possible without a headset.

Headless runs verify everything except rendering, XR tracking, audio output,
JNI (PDF rendering) and the permission flow — those remain device checklist
items (section 3).

### 2. Editor play mode (no device required)

PDF rendering and XR controller input are device-only, so editor play mode is
a layout smoke test:

1. Enter play mode in the `Main` scene.
2. Expected: the score, metronome and (hidden) picker panels are built in
   front of the camera and the score panel shows the no-score guidance
   message. Score rendering and picker interaction are verified on the
   device (next section).

### 3. On-device verification checklist

After installing on a Quest 3:

- [ ] App launches into passthrough (real room visible, no black background).
- [ ] Both panels appear in front of you; **Y** recenters them after moving.
- [ ] Without a score: instruction message explains how to get a PDF and
      open the picker.
- [ ] **Menu** opens the picker; on first use pressing **A** opens the
      system "all files access" screen, and after granting and returning the
      list shows PDFs from `Download`/`Documents` without an app restart.
- [ ] Right stick moves the highlight (list windows/scrolls past 12 items),
      **A** loads the selected PDF, **B**/**Menu** closes the picker.
- [ ] Page 1 renders sharply and the page counter shows the correct total.
- [ ] After relaunching the app, the last selected score reopens
      automatically.
- [ ] **A**/**B** turn pages and stop at both ends without wrapping.
- [ ] **X** starts the metronome: steady clicks, beat 1 accented (higher
      pitch, red dot), dots advance 1-2-3-4 in time with the audio.
- [ ] Right stick up/down changes BPM in steps of 5, clamped to 30–300, and
      the beat does not stutter or restart while running.
- [ ] Audio stays in time over several minutes (no drift against a reference
      metronome at e.g. 120 BPM).

### 4. Log inspection

```sh
adb logcat -s Unity
```

Score loading failures are logged as errors with the exception message, and
also surfaced on the score panel itself.

## Project conventions

- Follow the layered structure described in docs/design (ADR-004): pure logic
  in `Domain`, orchestration in `Usecase`, I/O in `Infra`, composition in
  `App`.
- New interfaces belong to the layer that consumes them (ports live in
  `Usecase/Ports.cs`).
- All comments and log messages are written in English.
- Add BDD-style EditMode tests (`If_xxx_it_should_yyy`) for any new domain or
  use case logic.

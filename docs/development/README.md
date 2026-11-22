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

The Quest settings below are already committed (`ProjectSettings/`,
`Assets/XR/`); rerun the configurator only after changing it.

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

The same build runs headless (the editor must not have the project open);
it exits non-zero when the build fails:

```sh
/Applications/Unity/Hub/Editor/6000.5.2f1/Unity.app/Contents/MacOS/Unity \
  -batchmode -projectPath . -buildTarget Android \
  -executeMethod GuitarMR.Editor.ProjectConfigurator.BuildAndroidApkForCi \
  [-guitarmrDevelopment] [-guitarmrIncludeTests] -logFile Logs/build.log
```

`-guitarmrDevelopment` makes a development build (needed for the
on-device smoke check below), `-guitarmrIncludeTests` adds the test
assemblies.

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

### 4. On-device smoke check (scriptable, Quest connected over USB)

```sh
./scripts/run-device-tests.sh
```

The script checks that one authorized device is connected, builds a
development APK, installs it, grants "all files access"
(`appops set ... MANAGE_EXTERNAL_STORAGE allow`), pushes a generated
two-page `guitarmr-smoke.pdf` to `Download`, and launches the app with
`--es guitarmr.smoke guitarmr-smoke.pdf`. In that mode (development builds
only) `SmokeScenario` drives the app through scripted controller input
instead of the real controllers and logs one line per check:

```text
GuitarMR smoke: PASS launch
GuitarMR smoke: PASS panels
GuitarMR smoke: PASS storage permission
GuitarMR smoke: PASS picker lists score
GuitarMR smoke: PASS pdf render
GuitarMR smoke: PASS page turn
GuitarMR smoke: RESULT PASS
```

The script waits for the `RESULT` line, saves `Logs/device-tests/logcat.txt`
and `Logs/device-tests/screenshot.png` (taken by the app itself; the host
`screencap` only returns a blank frame on Quest), and exits non-zero on
FAIL, on a crash or when no verdict arrives in time.

Nobody needs to wear the headset: the script fakes the proximity sensor and
pauses Guardian (`debug.oculus.guardian_pause`) for the run, and restores
both afterwards, because an unworn headset otherwise pauses the app and
closes it behind the "tracking lost" dialog. The checks run on the first
frame for the same reason.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADB` | `$ANDROID_HOME/platform-tools/adb`, else `/opt/homebrew/share/android-commandlinetools/platform-tools/adb` | adb binary |
| `ANDROID_SERIAL` | — | device to use when several are connected |
| `SMOKE_TIMEOUT` | `90` | seconds to wait for the verdict |
| `SKIP_BUILD` | `0` | `1` installs the existing `Builds/GuitarMR.apk` |

One-time setup: the Unity Android Build Support module, developer mode on
the headset, and USB debugging accepted on the headset for this computer.
If a build signed with another key is installed, `adb uninstall
com.gozenchu.guitarmr` first.

Not covered by the smoke check (still on the checklist in section 3):
passthrough, real controller input, audio output and timing.

### 5. Log inspection

```sh
adb logcat -s Unity
```

Score loading failures are logged as errors with the exception message, and
also surfaced on the score panel itself.

## Project conventions

- Follow the layered structure described in docs/design/mr.md (ADR-004): pure logic
  in `Domain`, orchestration in `Usecase`, I/O in `Infra`, composition in
  `App`.
- New interfaces belong to the layer that consumes them (ports live in
  `Usecase/Ports.cs`).
- All comments and log messages are written in English.
- Add BDD-style EditMode tests (`If_xxx_it_should_yyy`) for any new domain or
  use case logic.

# android

**tky**: the phone page of `web/` (`@guitarmr/demo`) as an Android app (ADR-010):
a WebView running the page from the app's assets, plus what a browser tab
lacks there:

| Page needs | The app gives it |
| --- | --- |
| claude.ai `sample` (reading with Claude) | The Claude API, called by the page with the user's own API key; the app asks for the key on the first reading and keeps it on the device |
| claude.ai `downloads` (saving `.gts.json`, the library export) | Android's save picker |
| `<input type="file">`, `capture` | The document picker; the camera app (photos land in `Pictures/tky`) |
| pdf.js from the CDN | pdf.js bundled in the app, so analysis works offline |

Kotlin with no libraries (platform `WebView` and `Activity` only). The
JavaScript side of the bridge is `web/packages/demo/src/android-host.ts`.

| App | Package | Built by |
| --- | --- | --- |
| tky | `xyz.amasuda.tky` | `main` → GitHub Release `vX.Y.N` |
| tky preview | `xyz.amasuda.tky.preview` | each PR → prerelease `tky preview prN X.Y.N` |

Both install side by side with their own data. To change or remove the API
key later, long-press the app icon → **API キー**.

## Install with Obtainium

[Obtainium](https://github.com/ImranR98/Obtainium) installs and updates the
app straight from this repository's GitHub releases.

- **Release app**: add `https://github.com/go-zen-chu/GuitarMR` with the
  default settings. Prereleases are ignored, so only `main` builds arrive.
- **Preview app (PR builds)**: add the same URL once more with
  - *Include prereleases*: on
  - *Filter release titles by regular expression*: `^tky preview`
    (every PR, newest build first), or `^tky preview pr12 ` for one PR

  Each push to a PR publishes a new prerelease and removes that PR's
  previous one; closing the PR removes them all. A PR from a fork gets no
  signing secrets and publishes nothing.

Every build is signed with the same release key, so updates install in
place. The release APK of a run is also kept as a workflow artifact.

## Build locally

Requires JDK 17 and the Android SDK (platform 36), plus the web workspace
setup (`web/README.md`).

```sh
(cd web && pnpm install && pnpm --filter @guitarmr/demo build:android)  # web/packages/demo/dist/android
cd android
./gradlew testReleaseUnitTest lintRelease assembleRelease assembleDebug  # the same as CI
adb install -r app/build/outputs/apk/debug/app-debug.apk                 # the preview app
```

Without the signing variables both builds use the local debug key. The
page in a debug build can be inspected from `chrome://inspect`.

## Signing

CI signs with a keystore from these repository secrets; a `main` build
fails without them, and the workflow checks that no published APK carries
the debug key.

| Secret | Value |
| --- | --- |
| `TKY_KEYSTORE_BASE64` | The keystore, base64 |
| `TKY_KEYSTORE_PASSWORD` | Its password |
| `TKY_KEY_PASSWORD` | The key password |

The key alias is `tky` (in `app/build.gradle.kts`): not a secret, and as
one it would mask every "tky" in the CI logs.

`android/scripts/setup-signing.sh` creates the key once (in
`~/.config/tky/` by default) and registers the secrets with `gh`.
Back up the keystore and its password file: Android only accepts updates
signed with the same key.

## Layout

```
app/src/main/java/xyz/amasuda/tky/
├── MainActivity.kt   Composition root: WebView, pickers, the key dialog, saving
├── HostBridge.kt     The page's `GuitarMRAndroid` interface (checks what the page passes)
├── PageAssets.kt     Which URLs are the page's own, and the bundled file for each
├── ApiKeyStore.kt    The API key on the device, and the check of a typed key
├── FileChooser.kt    `<input accept/capture>` to picker MIME types
└── Js.kt             Values handed back into the page as script literals
```

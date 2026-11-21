#!/usr/bin/env bash
# Runs the on-device smoke check on a Meta Quest connected over USB: builds a
# development APK, installs it, grants storage access, pushes a two-page sample
# PDF and launches the app in smoke mode (SmokeScenario). Waits for the verdict
# in logcat, saves logcat and a screenshot under Logs/device-tests/, prints the
# PASS/FAIL lines and exits non-zero unless every check passed.
#
# Environment:
#   ADB            adb binary (default: $ANDROID_HOME/platform-tools/adb, else the
#                  Homebrew android-commandlinetools one)
#   ANDROID_SERIAL device to use when several are connected (read by adb itself)
#   SMOKE_TIMEOUT  seconds to wait for the verdict after launch (default: 90)
#   SKIP_BUILD     set to 1 to install the existing Builds/GuitarMR.apk
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNITY_VERSION="$(awk '/m_EditorVersion:/ {print $2}' "${PROJECT_DIR}/ProjectSettings/ProjectVersion.txt")"
UNITY_ROOT="/Applications/Unity/Hub/Editor/${UNITY_VERSION}"
UNITY_BIN="${UNITY_ROOT}/Unity.app/Contents/MacOS/Unity"
PACKAGE="com.gozenchu.guitarmr"
APK="${PROJECT_DIR}/Builds/GuitarMR.apk"
OUT_DIR="${PROJECT_DIR}/Logs/device-tests"
SAMPLE_NAME="guitarmr-smoke.pdf"
DEVICE_SAMPLE="/sdcard/Download/${SAMPLE_NAME}"
DEVICE_SCREENSHOT="/sdcard/Android/data/${PACKAGE}/files/guitarmr-smoke.png"
SMOKE_PREFIX="GuitarMR smoke:"
SMOKE_TIMEOUT="${SMOKE_TIMEOUT:-90}"
SKIP_BUILD="${SKIP_BUILD:-0}"

if [[ -n "${ADB:-}" ]]; then
    :
elif [[ -n "${ANDROID_HOME:-}" ]]; then
    ADB="${ANDROID_HOME}/platform-tools/adb"
else
    ADB="/opt/homebrew/share/android-commandlinetools/platform-tools/adb"
fi

if ! [[ "${SMOKE_TIMEOUT}" =~ ^[0-9]+$ ]] || (( SMOKE_TIMEOUT == 0 )); then
    echo "error: SMOKE_TIMEOUT must be a positive number of seconds, got '${SMOKE_TIMEOUT}'" >&2
    exit 2
fi

# fail prints the message and exits with status 1.
fail() {
    echo "error: $*" >&2
    exit 1
}

# require_device fails unless exactly one authorized device is reachable.
require_device() {
    [[ -x "${ADB}" ]] || fail "adb not found at ${ADB}; set ADB or ANDROID_HOME"
    local state
    # Started up front so the daemon's startup notice does not end up in the state.
    "${ADB}" start-server >/dev/null 2>&1 || fail "could not start the adb server with ${ADB}"
    state="$("${ADB}" get-state 2>&1 || true)"
    case "${state}" in
        device) ;;
        *unauthorized*) fail "the headset has not allowed USB debugging: put it on and accept the prompt" ;;
        *more\ than\ one*) fail "several devices are connected; set ANDROID_SERIAL" ;;
        *) fail "no device found (${state}); connect the Quest over USB with developer mode on" ;;
    esac
}

# build_apk builds a development APK with the pinned Unity version in batch mode.
build_apk() {
    [[ -x "${UNITY_BIN}" ]] || fail "Unity ${UNITY_VERSION} not found at ${UNITY_BIN}; install it via Unity Hub"
    [[ -d "${UNITY_ROOT}/PlaybackEngines/AndroidPlayer" ]] \
        || fail "Unity ${UNITY_VERSION} has no Android Build Support; add the module in Unity Hub"
    echo "building ${APK} (log: ${OUT_DIR}/build.log)"
    "${UNITY_BIN}" \
        -batchmode \
        -projectPath "${PROJECT_DIR}" \
        -buildTarget Android \
        -executeMethod GuitarMR.Editor.ProjectConfigurator.BuildAndroidApkForCi \
        -guitarmrDevelopment \
        -logFile "${OUT_DIR}/build.log" \
        || { tail -n 30 "${OUT_DIR}/build.log" >&2 || true; fail "the APK build failed"; }
}

# write_sample_pdf writes a two-page PDF (title and staff lines per page) to the given path.
write_sample_pdf() {
    local out="$1" page objects=() offsets=() body="" i
    for page in 1 2; do
        local content="BT /F1 40 Tf 72 700 Td (GuitarMR smoke page ${page}) Tj ET 2 w"
        for i in 0 1 2 3 4; do
            content+=" 72 $((560 - i * 16)) m 540 $((560 - i * 16)) l S"
        done
        objects+=("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents $((page * 2 + 2)) 0 R >>")
        objects+=("<< /Length ${#content} >>
stream
${content}
endstream")
    done
    objects=("<< /Type /Catalog /Pages 2 0 R >>" "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>" "${objects[@]}" \
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    body="%PDF-1.4"$'\n'
    for i in "${!objects[@]}"; do
        offsets+=("${#body}")
        body+="$((i + 1)) 0 obj"$'\n'"${objects[i]}"$'\n'"endobj"$'\n'
    done
    local xref_offset="${#body}"
    body+="xref"$'\n'"0 $(( ${#objects[@]} + 1 ))"$'\n'"0000000000 65535 f "$'\n'
    for i in "${offsets[@]}"; do
        body+="$(printf '%010d' "${i}") 00000 n "$'\n'
    done
    body+="trailer"$'\n'"<< /Size $(( ${#objects[@]} + 1 )) /Root 1 0 R >>"$'\n'"startxref"$'\n'"${xref_offset}"$'\n'"%%EOF"$'\n'
    printf '%s' "${body}" > "${out}"
}

# restore_device lets the headset sleep again, restores Guardian and stops the log capture.
restore_device() {
    "${ADB}" shell am broadcast -a com.oculus.vrpowermanager.automation_disable >/dev/null 2>&1 || true
    "${ADB}" shell setprop debug.oculus.guardian_pause "${GUARDIAN_PAUSE_BEFORE:-0}" >/dev/null 2>&1 || true
    if [[ -n "${LOGCAT_PID:-}" ]]; then
        kill "${LOGCAT_PID}" 2>/dev/null || true
    fi
}

# pull_screenshot copies the screenshot the app saves after the checks (the host
# screencap only captures a blank frame on Quest), waiting a few seconds for it.
pull_screenshot() {
    local _
    for _ in 1 2 3 4 5; do
        if "${ADB}" pull "${DEVICE_SCREENSHOT}" "${OUT_DIR}/screenshot.png" >/dev/null 2>&1; then
            return
        fi
        sleep 1
    done
    echo "warning: the app saved no screenshot at ${DEVICE_SCREENSHOT}" >&2
}

# wait_for_verdict waits for the RESULT line and prints PASS or FAIL, or TIMEOUT / CRASH.
wait_for_verdict() {
    local started=${SECONDS} line
    local deadline=$((started + SMOKE_TIMEOUT))
    while (( SECONDS < deadline )); do
        line="$(grep -o "${SMOKE_PREFIX} RESULT [A-Z]*" "${OUT_DIR}/logcat.txt" | head -n 1 || true)"
        if [[ -n "${line}" ]]; then
            echo "${line##* }"
            return
        fi
        # Give the app a few seconds to start before treating a missing process as a crash.
        if (( SECONDS > started + 10 )) && ! "${ADB}" shell pidof "${PACKAGE}" >/dev/null 2>&1; then
            echo "CRASH"
            return
        fi
        sleep 2
    done
    echo "TIMEOUT"
}

LC_ALL=C
export LC_ALL
mkdir -p "${OUT_DIR}"
rm -f "${OUT_DIR}/logcat.txt" "${OUT_DIR}/screenshot.png"

require_device
if [[ "${SKIP_BUILD}" == "1" ]]; then
    [[ -f "${APK}" ]] || fail "SKIP_BUILD=1 but ${APK} does not exist"
else
    build_apk
fi

echo "installing ${APK}"
"${ADB}" install -r "${APK}" >/dev/null \
    || fail "install failed; if another build is installed with a different signature, run: ${ADB} uninstall ${PACKAGE}"
"${ADB}" shell appops set "${PACKAGE}" MANAGE_EXTERNAL_STORAGE allow
write_sample_pdf "${OUT_DIR}/${SAMPLE_NAME}"
"${ADB}" push "${OUT_DIR}/${SAMPLE_NAME}" "${DEVICE_SAMPLE}" >/dev/null

GUARDIAN_PAUSE_BEFORE="$("${ADB}" shell getprop debug.oculus.guardian_pause | tr -d '\r')"
trap restore_device EXIT
# An unworn Quest pauses apps (proximity sensor) and closes them behind the
# "tracking lost" Guardian dialog; pretend it is worn and pause Guardian meanwhile.
"${ADB}" shell input keyevent KEYCODE_WAKEUP
"${ADB}" shell am broadcast -a com.oculus.vrpowermanager.prox_close >/dev/null
"${ADB}" shell setprop debug.oculus.guardian_pause 1

"${ADB}" shell am force-stop "${PACKAGE}"
"${ADB}" shell rm -f "${DEVICE_SCREENSHOT}"
"${ADB}" logcat -c
"${ADB}" logcat -v time > "${OUT_DIR}/logcat.txt" 2>&1 &
LOGCAT_PID=$!

ACTIVITY="$("${ADB}" shell cmd package resolve-activity --brief -c android.intent.category.LAUNCHER "${PACKAGE}" | tail -n 1 | tr -d '\r')"
[[ "${ACTIVITY}" == "${PACKAGE}/"* ]] || fail "could not resolve the launcher activity of ${PACKAGE}: ${ACTIVITY}"
echo "launching ${ACTIVITY} in smoke mode (timeout ${SMOKE_TIMEOUT}s)"
"${ADB}" shell am start -n "${ACTIVITY}" --es guitarmr.smoke "${SAMPLE_NAME}" >/dev/null

VERDICT="$(wait_for_verdict)"
pull_screenshot
"${ADB}" shell am force-stop "${PACKAGE}"
restore_device
trap - EXIT

grep -o "${SMOKE_PREFIX} .*" "${OUT_DIR}/logcat.txt" | tr -d '\r' || true
echo "logcat: ${OUT_DIR}/logcat.txt"
echo "screenshot: ${OUT_DIR}/screenshot.png"
case "${VERDICT}" in
    PASS) echo "device smoke check passed" ;;
    FAIL) fail "device smoke check failed" ;;
    CRASH) fail "the app stopped before reporting a verdict; see the logcat" ;;
    *) fail "no verdict within ${SMOKE_TIMEOUT}s; see the logcat" ;;
esac

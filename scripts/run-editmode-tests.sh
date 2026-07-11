#!/usr/bin/env bash
# Runs the EditMode test suite headless with the Unity version pinned in
# ProjectSettings/ProjectVersion.txt. Works without a device or an open
# editor, so both humans and AI agents can verify changes locally.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
UNITY_VERSION="$(awk '/m_EditorVersion:/ {print $2}' "${PROJECT_DIR}/ProjectSettings/ProjectVersion.txt")"
UNITY_BIN="/Applications/Unity/Hub/Editor/${UNITY_VERSION}/Unity.app/Contents/MacOS/Unity"

if [[ ! -x "${UNITY_BIN}" ]]; then
    echo "error: Unity ${UNITY_VERSION} not found at ${UNITY_BIN}; install it via Unity Hub" >&2
    exit 1
fi

RESULTS="${PROJECT_DIR}/Logs/editmode-results.xml"
LOG="${PROJECT_DIR}/Logs/editmode-tests.log"
mkdir -p "${PROJECT_DIR}/Logs"

# -runTests exits on completion; non-zero status means compile errors or test failures.
status=0
"${UNITY_BIN}" \
    -batchmode \
    -projectPath "${PROJECT_DIR}" \
    -runTests \
    -testPlatform EditMode \
    -testResults "${RESULTS}" \
    -logFile "${LOG}" \
    || status=$?

if [[ -f "${RESULTS}" ]]; then
    # The first test-run element carries the aggregated counts.
    grep -o '<test-run [^>]*>' "${RESULTS}" | head -n 1 \
        | grep -o '\(total\|passed\|failed\|skipped\)="[0-9]*"' || true
else
    echo "error: no test results were produced; check ${LOG}" >&2
    tail -n 30 "${LOG}" >&2 || true
fi

exit "${status}"

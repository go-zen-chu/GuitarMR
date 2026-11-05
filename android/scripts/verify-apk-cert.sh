#!/usr/bin/env bash
# Check that an APK is signed by the expected certificate (used by CI).
#
#   android/scripts/verify-apk-cert.sh <apk> <certificate SHA-256, lowercase hex>
#
# Uses the newest apksigner in $ANDROID_HOME/build-tools.
set -euo pipefail

if [[ $# -ne 2 ]]; then
	sed -n '2,6p' "$0" | sed 's/^# \{0,1\}//'
	exit 1
fi
apk="$1"
expected="$2"

apksigner=$(find "$ANDROID_HOME/build-tools" -name apksigner | sort -V | tail -1)
if [[ -z "$apksigner" ]]; then
	echo "::error::apksigner not found under $ANDROID_HOME/build-tools" >&2
	exit 1
fi

output=$("$apksigner" verify --print-certs "$apk" 2>&1) || {
	echo "$output" >&2
	echo "::error::apksigner could not verify $apk" >&2
	exit 1
}
# An unreadable digest stays empty and fails the comparison below.
actual=$(grep -m1 -oiE 'certificate SHA-256 digest: [0-9a-f]{64}' <<<"$output" | awk '{print tolower($NF)}' || true)
if [[ "$actual" != "$expected" ]]; then
	echo "$output" >&2
	echo "::error::$apk is signed by '${actual:-unknown}', expected $expected" >&2
	exit 1
fi
echo "$apk is signed by $expected"

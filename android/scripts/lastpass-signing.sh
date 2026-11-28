#!/usr/bin/env bash
# Back up a PKCS12 signing key to a LastPass secure note, or restore it.
#
#   android/scripts/lastpass-signing.sh backup|restore <name> <keystore> [password file]
#
# The note is "$LPASS_SIGNING_FOLDER/<name>" (folder "Signing" by default) and
# holds the key's password, its certificate SHA-256 and the keystore in base64.
# The password file defaults to <keystore>.password (setup-signing.sh's layout).
#   backup:  refuses to replace an existing note, then reads the note back and
#            compares it with the local files.
#   restore: refuses to overwrite local files, and checks that the restored
#            keystore opens with the restored password.
# Requires lpass (logged in: lpass login <email>) and openssl.
set -euo pipefail

if [[ $# -lt 3 || $# -gt 4 || ( "$1" != "backup" && "$1" != "restore" ) ]]; then
	sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//' >&2
	exit 1
fi
ACTION="$1"
ENTRY="${LPASS_SIGNING_FOLDER:-Signing}/$2"
KEYSTORE="$3"
PASSWORD_FILE="${4:-$KEYSTORE.password}"

command -v lpass >/dev/null || { echo "lpass not found: brew install lastpass-cli" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl not found" >&2; exit 1; }
lpass status -q || { echo "lpass is not logged in: run lpass login <email>" >&2; exit 1; }

# Prints the certificate SHA-256 (lowercase hex, as in .github/workflows/android.yml).
cert_sha256() {
	openssl pkcs12 -in "$1" -nokeys -passin "file:$2" 2>/dev/null |
		openssl x509 -noout -fingerprint -sha256 2>/dev/null |
		cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]' || true
}

# Prints the value of a "Key: value" line of the note.
note_field() {
	sed -n "s/^$1: //p" <<<"$2" | head -1
}

if [[ "$ACTION" == "backup" ]]; then
	[[ -r "$KEYSTORE" ]] || { echo "$KEYSTORE is not readable" >&2; exit 1; }
	[[ -r "$PASSWORD_FILE" ]] || { echo "$PASSWORD_FILE is not readable" >&2; exit 1; }
	if lpass show --sync=now "$ENTRY" >/dev/null 2>&1; then
		echo "$ENTRY already exists in LastPass: remove it there first to replace it" >&2
		exit 1
	fi
	sha256=$(cert_sha256 "$KEYSTORE" "$PASSWORD_FILE")
	[[ -n "$sha256" ]] || { echo "Cannot open $KEYSTORE with the password in $PASSWORD_FILE" >&2; exit 1; }
	keystore_base64=$(base64 < "$KEYSTORE" | tr -d '\n')

	# The note goes through stdin so the password never shows up in the process list.
	{
		echo "Signing key backup (PKCS12) by android/scripts/lastpass-signing.sh"
		echo "File: $(basename "$KEYSTORE")"
		echo "Certificate-SHA256: $sha256"
		echo "Password: $(tr -d '\n' < "$PASSWORD_FILE")"
		echo "Keystore-Base64: $keystore_base64"
	} | lpass add --sync=now --non-interactive --note-type=generic --notes "$ENTRY"

	stored=$(lpass show --sync=now --notes "$ENTRY")
	if [[ "$(note_field Keystore-Base64 "$stored")" != "$keystore_base64" ||
		"$(note_field Password "$stored")" != "$(tr -d '\n' < "$PASSWORD_FILE")" ]]; then
		echo "The note $ENTRY does not match the local files: check it in LastPass" >&2
		exit 1
	fi
	echo "Backed up $KEYSTORE to $ENTRY (certificate SHA-256 $sha256)."
else
	for file in "$KEYSTORE" "$PASSWORD_FILE"; do
		[[ ! -e "$file" ]] || { echo "$file already exists: not overwriting it" >&2; exit 1; }
	done
	stored=$(lpass show --sync=now --notes "$ENTRY")
	keystore_base64=$(note_field Keystore-Base64 "$stored")
	[[ -n "$keystore_base64" ]] || { echo "$ENTRY has no Keystore-Base64 line" >&2; exit 1; }

	mkdir -p "$(dirname "$KEYSTORE")" "$(dirname "$PASSWORD_FILE")"
	umask 077
	printf '%s' "$(note_field Password "$stored")" > "$PASSWORD_FILE"
	base64 -d <<<"$keystore_base64" > "$KEYSTORE"

	sha256=$(cert_sha256 "$KEYSTORE" "$PASSWORD_FILE")
	if [[ -z "$sha256" || "$sha256" != "$(note_field Certificate-SHA256 "$stored")" ]]; then
		echo "The restored $KEYSTORE does not match the certificate in $ENTRY" >&2
		exit 1
	fi
	echo "Restored $ENTRY to $KEYSTORE (password in $PASSWORD_FILE, certificate SHA-256 $sha256)."
fi

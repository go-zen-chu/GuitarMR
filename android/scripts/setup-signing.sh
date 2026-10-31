#!/usr/bin/env bash
# Create the tky release signing key once and register it as GitHub Actions secrets.
#
#   android/scripts/setup-signing.sh [keystore path]
#
# The keystore (default ~/.config/tky/tky-release.jks) and its password
# file stay on this machine; back both up. Losing them means installed apps can
# no longer be updated in place (Android only accepts updates signed with the same key).
# Requires keytool (a JDK) and gh (logged in with access to the repository).
set -euo pipefail

REPO="${TKY_REPO:-go-zen-chu/GuitarMR}"
KEYSTORE="${1:-$HOME/.config/tky/tky-release.jks}"
PASSWORD_FILE="$KEYSTORE.password"
ALIAS="tky" # app/build.gradle.kts signs with this alias

command -v keytool >/dev/null || { echo "keytool not found: install a JDK (e.g. brew install openjdk@17)" >&2; exit 1; }
command -v gh >/dev/null || { echo "gh not found: install the GitHub CLI and run gh auth login" >&2; exit 1; }

if [[ -e "$KEYSTORE" ]]; then
	echo "Using the existing keystore $KEYSTORE"
	[[ -r "$PASSWORD_FILE" ]] || { echo "$PASSWORD_FILE is missing: cannot register the secrets" >&2; exit 1; }
else
	mkdir -p "$(dirname "$KEYSTORE")"
	umask 077
	openssl rand -base64 24 | tr -d '/+=\n' > "$PASSWORD_FILE"
	# PKCS12 keystores use one password for the store and the key.
	keytool -genkeypair -v -keystore "$KEYSTORE" -storetype PKCS12 -alias "$ALIAS" \
		-keyalg RSA -keysize 4096 -validity 10000 \
		-storepass:file "$PASSWORD_FILE" -dname "CN=tky, O=amasuda.xyz"
	echo "Created $KEYSTORE (password in $PASSWORD_FILE). Back both up."
fi

# Values go through stdin so they never show up in the process list.
base64 < "$KEYSTORE" | tr -d '\n' | gh secret set TKY_KEYSTORE_BASE64 -R "$REPO"
gh secret set TKY_KEYSTORE_PASSWORD -R "$REPO" < "$PASSWORD_FILE"
gh secret set TKY_KEY_PASSWORD -R "$REPO" < "$PASSWORD_FILE"
echo "Registered the signing secrets in $REPO."
keytool -list -v -keystore "$KEYSTORE" -storepass:file "$PASSWORD_FILE" | grep -m1 "SHA256:"

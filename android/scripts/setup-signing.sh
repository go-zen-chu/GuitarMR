#!/usr/bin/env bash
# Create a tky signing key once and register it as GitHub Actions secrets.
#
#   android/scripts/setup-signing.sh release|preview [keystore path]
#
# - release: the release app's key, as secrets of the "release" environment
#   (created here, deployable from main only). The old repository secrets of the
#   release key are removed, so PR builds can no longer read it.
# - preview: the preview app's key, as repository secrets (PR builds use it).
#
# The keystore (default ~/.config/tky/tky-<app>.jks) and its password file stay
# on this machine; back both up. Losing them means installed apps can no longer
# be updated in place (Android only accepts updates signed with the same key).
# Requires keytool (a JDK) and gh (logged in with admin access to the repository).
set -euo pipefail

REPO="${TKY_REPO:-go-zen-chu/GuitarMR}"
APP="${1:-}"
[[ "$APP" == "release" || "$APP" == "preview" ]] || { echo "usage: $0 release|preview [keystore path]" >&2; exit 1; }
KEYSTORE="${2:-$HOME/.config/tky/tky-$APP.jks}"
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
		-storepass:file "$PASSWORD_FILE" -dname "CN=tky $APP, O=amasuda.xyz"
	echo "Created $KEYSTORE (password in $PASSWORD_FILE). Back both up."
fi

# Values go through stdin so they never show up in the process list.
if [[ "$APP" == "release" ]]; then
	gh api -X PUT "repos/$REPO/environments/release" --silent \
		--input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}'
	if ! gh api "repos/$REPO/environments/release/deployment-branch-policies" \
		-q '.branch_policies[].name' | grep -qxF main; then
		gh api -X POST "repos/$REPO/environments/release/deployment-branch-policies" \
			-f name=main -f type=branch --silent
	fi
	base64 < "$KEYSTORE" | tr -d '\n' | gh secret set TKY_KEYSTORE_BASE64 -R "$REPO" --env release
	gh secret set TKY_KEYSTORE_PASSWORD -R "$REPO" --env release < "$PASSWORD_FILE"
	gh secret set TKY_KEY_PASSWORD -R "$REPO" --env release < "$PASSWORD_FILE"
	for name in TKY_KEYSTORE_BASE64 TKY_KEYSTORE_PASSWORD TKY_KEY_PASSWORD; do
		if gh secret list -R "$REPO" --json name -q '.[].name' | grep -qxF "$name"; then
			gh secret delete "$name" -R "$REPO"
		fi
	done
	echo "Registered the release key in the release environment of $REPO (main only)."
else
	base64 < "$KEYSTORE" | tr -d '\n' | gh secret set TKY_PREVIEW_KEYSTORE_BASE64 -R "$REPO"
	gh secret set TKY_PREVIEW_KEYSTORE_PASSWORD -R "$REPO" < "$PASSWORD_FILE"
	echo "Registered the preview key in $REPO."
fi
keytool -list -v -keystore "$KEYSTORE" -storepass:file "$PASSWORD_FILE" | grep -m1 "SHA256:"

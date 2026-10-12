#!/bin/sh
# Builds the Safari (macOS) wrapper app from the same sources Chrome loads and installs it into /Applications.
# The Xcode project references safari/ext/, a runtime-only copy refreshed here; pointing it at the
# repo root made Xcode copy safari/build into itself recursively until the disk filled up.
set -eu
cd "$(dirname "$0")"
root=..
app="YouTube Sponsor Skip.app"

rm -rf ext
mkdir -p ext/lib
for f in manifest.json background.js content.js page-hook.js popup.html popup.js options.html options.js; do
  cp "$root/$f" ext/
done
cp "$root"/lib/*.js ext/lib/
mkdir -p ext/icons && cp "$root"/icons/*.png ext/icons/

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
# With an "Apple Development" certificate in the keychain (a free Apple ID is enough) the app is signed
# with it, and Safari keeps the extension across restarts without "Allow unsigned extensions". Without
# one it falls back to an ad-hoc signature ("Sign to Run Locally"): then the unsigned toggle is needed
# after every Safari restart, followed by reenable.sh. TEAM_ID / SIGN_IDENTITY override the detection.
if [ -z "${SIGN_IDENTITY:-}" ] && security find-identity -v -p codesigning | grep -q '"Apple Development'; then
  SIGN_IDENTITY="Apple Development"
fi
identity="${SIGN_IDENTITY:--}"
team=
if [ "$identity" != "-" ]; then
  team="${TEAM_ID:-$(security find-certificate -c "$identity" -p | openssl x509 -noout -subject -nameopt multiline \
    | awk -F' = ' '/organizationalUnitName/{print $2; exit}')}"
fi
echo "Signing: identity=$identity team=${team:-none}"
xcodebuild -project "YouTube Sponsor Skip/YouTube Sponsor Skip.xcodeproj" -scheme "YouTube Sponsor Skip" \
  -configuration Release -derivedDataPath build CODE_SIGN_IDENTITY="$identity" CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$team" PROVISIONING_PROFILE_SPECIFIER= \
  build -quiet

# Install outside the build folder so Safari keeps the extension when build/ is cleaned; then drop the
# build copy from LaunchServices so Safari does not see two extensions with the same id.
built="build/Build/Products/Release/$app"
rm -rf "/Applications/$app"
ditto "$built" "/Applications/$app"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$built" || true
rm -rf build
open "/Applications/$app"
echo "Installed: /Applications/$app"

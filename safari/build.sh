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

export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
# Ad-hoc signature ("Sign to Run Locally"): needs Safari's "Allow unsigned extensions".
xcodebuild -project "YouTube Sponsor Skip/YouTube Sponsor Skip.xcodeproj" -scheme "YouTube Sponsor Skip" \
  -configuration Release -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= \
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

#!/usr/bin/env bash
set -euo pipefail

# Build the Swift UI and wrap it in a minimal .app bundle so macOS treats it
# as a GUI application (no Terminal window, proper icon, works in Login Items).
# The CLI is NOT bundled — it must be installed separately (npm i -g backdot).

cd "$(dirname "$0")/.."
REPO_ROOT="$(cd .. && pwd)"

swift build -c release

APP=".build/Backdot.app"
rm -rf "$APP"
mkdir -p "${APP}/Contents/MacOS" "${APP}/Contents/Resources"

sed "s/__VERSION__/dev/g" Info.plist > "${APP}/Contents/Info.plist"
cp .build/release/BackdotUI "${APP}/Contents/MacOS/BackdotUI"

# Generate app icon if the logo exists
if [[ -f "${REPO_ROOT}/logo-square.png" ]]; then
  ICONSET="${APP}/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for SIZE in 16 32 128 256 512; do
    sips -z $SIZE $SIZE "${REPO_ROOT}/logo-square.png" --out "${ICONSET}/icon_${SIZE}x${SIZE}.png" >/dev/null
    DOUBLE=$((SIZE * 2))
    sips -z $DOUBLE $DOUBLE "${REPO_ROOT}/logo-square.png" --out "${ICONSET}/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
  done
  iconutil -c icns -o "${APP}/Contents/Resources/AppIcon.icns" "$ICONSET"
  rm -rf "$ICONSET"
fi

echo "Built ${APP}"

#!/usr/bin/env bash
set -euo pipefail

# Build a self-contained Backdot.app and package it as a DMG.
#
# Usage:
#   ./scripts/build-app.sh              # build for current architecture
#   ./scripts/build-app.sh arm64        # build for Apple Silicon
#   ./scripts/build-app.sh x86_64       # build for Intel

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ARCH="${1:-$(uname -m)}"
NODE_VERSION="22.14.0"
VERSION=$(node -p "require('./cli/package.json').version")
BUILD_DIR="${REPO_ROOT}/build"
APP="${BUILD_DIR}/Backdot.app"

echo "Building Backdot v${VERSION} for ${ARCH}"
echo ""

# ── Clean previous build ──────────────────────────────────────────────────────

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ── 1. Build CLI (TypeScript → JavaScript) ────────────────────────────────────

echo "Compiling CLI…"
(cd cli && npm run build)

# ── 2. Bundle CLI into a single file ──────────────────────────────────────────

echo "Bundling CLI with esbuild…"
npx --prefix cli esbuild cli/dist/cli.js \
  --bundle \
  --platform=node \
  --format=esm \
  --banner:js="import { createRequire } from 'module'; const require = createRequire(import.meta.url);" \
  --outfile="${BUILD_DIR}/cli.js"

# ── 3. Download Node.js binary ────────────────────────────────────────────────

NODE_ARCH="$ARCH"
if [[ "$NODE_ARCH" == "aarch64" ]]; then
  NODE_ARCH="arm64"
fi

NODE_TARBALL="node-v${NODE_VERSION}-darwin-${NODE_ARCH}"
NODE_URL="https://nodejs.org/dist/v${NODE_VERSION}/${NODE_TARBALL}.tar.gz"

if [[ -f "${BUILD_DIR}/node" ]]; then
  echo "Node.js binary already downloaded, skipping."
else
  echo "Downloading Node.js v${NODE_VERSION} for ${NODE_ARCH}…"
  curl -fsSL "$NODE_URL" | tar xz -C "$BUILD_DIR"
  cp "${BUILD_DIR}/${NODE_TARBALL}/bin/node" "${BUILD_DIR}/node"
  rm -rf "${BUILD_DIR}/${NODE_TARBALL}"
fi

# ── 4. Build Swift UI ─────────────────────────────────────────────────────────

echo "Building Swift UI…"
(cd ui && swift build -c release --arch "$ARCH")

# ── 5. Assemble .app bundle ──────────────────────────────────────────────────

echo "Assembling Backdot.app…"

mkdir -p "${APP}/Contents/MacOS"
mkdir -p "${APP}/Contents/Resources"

# Info.plist — replace __VERSION__ placeholder with actual version
sed "s/__VERSION__/${VERSION}/g" ui/Info.plist > "${APP}/Contents/Info.plist"

# Swift executable
cp "ui/.build/release/BackdotUI" "${APP}/Contents/MacOS/BackdotUI"

# Node.js runtime and bundled CLI
cp "${BUILD_DIR}/node" "${APP}/Contents/Resources/node"
cp "${BUILD_DIR}/cli.js" "${APP}/Contents/Resources/cli.js"

# Minimal package.json so the CLI can read its version at runtime
# (getVersion() resolves ../package.json relative to cli.js)
echo "{\"version\":\"${VERSION}\",\"type\":\"module\"}" > "${APP}/Contents/package.json"

# App icon (convert PNG → icns via iconutil)
ICONSET="${BUILD_DIR}/AppIcon.iconset"
mkdir -p "$ICONSET"
for SIZE in 16 32 128 256 512; do
  sips -z $SIZE $SIZE logo-square.png --out "${ICONSET}/icon_${SIZE}x${SIZE}.png" >/dev/null
  DOUBLE=$((SIZE * 2))
  sips -z $DOUBLE $DOUBLE logo-square.png --out "${ICONSET}/icon_${SIZE}x${SIZE}@2x.png" >/dev/null
done
iconutil -c icns -o "${APP}/Contents/Resources/AppIcon.icns" "$ICONSET"
rm -rf "$ICONSET"

# Wrapper script that ties node + cli.js together
cat > "${APP}/Contents/Resources/backdot" << 'WRAPPER'
#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "$DIR/node" "$DIR/cli.js" "$@"
WRAPPER
chmod +x "${APP}/Contents/Resources/backdot"

# ── 6. Create DMG ─────────────────────────────────────────────────────────────

DMG_NAME="Backdot-${VERSION}-${ARCH}.dmg"
echo "Creating ${DMG_NAME}…"

hdiutil create \
  -volname "Backdot" \
  -srcfolder "$APP" \
  -ov \
  -format UDZO \
  "${BUILD_DIR}/${DMG_NAME}"

# ── Done ──────────────────────────────────────────────────────────────────────

DMG_SIZE=$(du -h "${BUILD_DIR}/${DMG_NAME}" | cut -f1 | xargs)
echo ""
echo "Done! ${DMG_NAME} (${DMG_SIZE})"
echo "  ${BUILD_DIR}/${DMG_NAME}"

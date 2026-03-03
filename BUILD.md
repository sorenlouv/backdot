# Building Backdot

## Prerequisites

- **Node.js** >= 18 ([nodejs.org](https://nodejs.org))
- **Swift** >= 5.9 / Xcode Command Line Tools (`xcode-select --install`)
- **Git**

## CLI

The CLI is a standalone Node.js application in `cli/`.

```bash
cd cli
npm ci
npm run build
```

This compiles TypeScript to `cli/dist/`. Run the CLI directly with:

```bash
node dist/cli.js --help
```

### Testing

```bash
npm test          # unit tests
npm run test:all  # build + all tests (unit, integration, e2e)
```

### Watch mode

```bash
npm run build:watch
```

## Swift UI

The macOS menu bar app lives in `ui/` and is built with Swift Package Manager.

```bash
cd ui
./scripts/build.sh
```

This compiles the Swift code and assembles a minimal `.app` bundle at `ui/.build/Backdot.app` (with Info.plist and app icon). To build and launch in one step:

```bash
./scripts/run.sh
```

The `.app` can also be double-clicked in Finder or added to Login Items.

> **Note:** The Swift UI calls the `backdot` CLI at runtime. During development, install the CLI globally first (`cd cli && npm install -g .`) so the UI can find it on your PATH.

## macOS Distributable

`scripts/build-app.sh` produces a self-contained `.app` bundle packaged as a DMG. It bundles the Swift UI, the CLI (compiled into a single JS file via esbuild), and a standalone Node.js runtime — users don't need Node.js or npm installed.

```bash
./scripts/build-app.sh            # build for current architecture
./scripts/build-app.sh arm64      # Apple Silicon
./scripts/build-app.sh x86_64     # Intel
```

Output: `build/Backdot-<version>-<arch>.dmg`

### CI

The DMG is built automatically by CI and attached to every GitHub Release. You can also trigger a build manually:

```bash
gh workflow run build-app.yml --ref main
gh run watch
```
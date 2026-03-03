# AGENTS.md

Read [SPEC.md](SPEC.md) for the product specification (features, behavior, invariants). This file covers how to work on the codebase.

## Principles

Fast, simple, beautiful. When in doubt, leave it out.

## Architecture

- **CLI owns all logic.** The Node.js CLI (`cli/src/`) is the single source of truth for every operation — backup, restore, scheduling, visibility checks, encryption, etc. The Swift macOS UI (`ui/`) is a thin shell that calls CLI commands and displays their output. Never put business logic in Swift; if the UI needs new data, add it to the relevant CLI command's JSON output and parse it in Swift.
- **Paths are defined once.** Every user-facing filesystem path (`~/.backdot/config.json`, `~/.backdot/encryption.key`, log paths, staging dirs, etc.) is defined as a named constant in `cli/src/paths.ts`. Other modules import from there — never construct paths with `os.homedir()` + `".backdot"` inline. The Swift UI retrieves paths at startup via `backdot paths` (JSON output) so they are never duplicated.

## Swift UI

The macOS UI (`ui/`) must look and feel like a native macOS application. Follow these rules:

- **Use native SwiftUI controls and styles.** No custom-drawn borders, backgrounds, or focus rings. Use `.textFieldStyle(.roundedBorder)`, `.formStyle(.grouped)`, `.pickerStyle(.segmented)`, system toggles, etc.
- **Auto-save settings.** macOS settings windows do not have Save/Cancel buttons. Text fields save on commit (Enter or focus loss); toggles and list mutations save immediately. The only exception is security-sensitive actions (e.g. setting a password) which use an explicit confirmation button.
- **Toolbar for navigation.** Place segmented controls and tabs in the window toolbar (`.toolbar` with `placement: .principal`), not in the view body.
- **System colors only.** Use `.secondary`, `.tertiary`, `Color.accentColor`, and semantic colors. Never hardcode colors like `.green` or `.red` for action icons.
- **Keep it minimal.** If a piece of UI chrome does not clearly help the user, remove it.

## Code style

- **Clarity over brevity.** Long, obvious names are better than short, opaque ones. Code should be self-explanatory. If a name alone can't convey the intent, consider abstracting to a function, or add a comment — but prefer renaming first. The goal is to improve readability and understanding.
- **Naming guidelines.** For every variable, function, parameter, and non-trivial expression, a new contributor should understand its purpose instantly. Apply these strategies in order of preference:
  1. **Rename** to something self-documenting (e.g. `p` → `pattern`, `msg` → `normalizedMessage`, `flags` → `showFileNames`).
  2. **Extract a named variable** when an inline expression hides intent (e.g. `mode & 0o077` → `const isAccessibleByGroupOrOthers = (mode & 0o077) !== 0`).
  3. **Extract a named function** when a block of logic deserves a descriptive name (e.g. `walkDir` → `listFilesRecursively`).
  4. **Add a comment** only as a last resort, when renaming or extraction cannot capture the "why" (e.g. explaining that `!` is preserved because fast-glob uses it for negation patterns).
- **No narration comments.** Never add comments that just restate what the code does. Comments should explain non-obvious intent, trade-offs, or constraints.

## Scope

- **Git is the only backend.** Non-git backends: firm no.
- The 10 MB file-size limit has no strong justification — can be raised or removed.
- Other features: consider if highly requested and/or simple to implement.

## Testing

```bash
cd cli
npm test              # unit tests (vitest)
npm run test:e2e      # build + e2e
```

Override `HOME` to test without touching real config:

```bash
HOME=$(mktemp -d) node cli/dist/cli.js init
```

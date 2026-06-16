# AGENTS.md

Read [SPEC.md](SPEC.md) for the product specification (features, behavior, invariants). This file covers how to work on the codebase.

## Principles

Fast, simple, beautiful. When in doubt, leave it out.

## Architecture

- **Single CLI package.** The Node.js CLI (`src/`) is the entire product — backup, restore, scheduling, visibility checks, encryption, etc. backdot is a command-line tool with no graphical UI.
- **Paths are defined once.** Every user-facing filesystem path (`~/.backdot/config.json`, `~/.backdot/encryption.key`, log paths, staging dirs, etc.) is defined as a named constant in `src/paths.ts`. Other modules import from there — never construct paths with `os.homedir()` + `".backdot"` inline.

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
- **GitHub is the only provider; HTTPS + PAT only; no SSH.** Other hosts (GitLab/Bitbucket) and SSH (`git@`/`ssh://`) are rejected.
- The 10 MB file-size limit has no strong justification — can be raised or removed.
- Other features: consider if highly requested and/or simple to implement.

## Testing

```bash
npm test              # unit tests (vitest)
npm run test:e2e      # build + e2e
```

Override `HOME` to test without touching real config:

```bash
HOME=$(mktemp -d) node dist/cli.js init
```

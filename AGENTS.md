# AGENTS.md

## Why this tool exists

The author lost a machine and with it irreplaceable files: SSH keys, shell history, years of zsh config, gitignored dev configs. Backdot ensures this never happens again by automatically backing up dotfiles and gitignored files to a Git repo.

Inspired by [mackup](https://github.com/lra/mackup), but mackup replaces files with symlinks — that's intrusive and has caused data loss. Backdot only copies; it never modifies or replaces originals.

## Principles

Fast, simple, beautiful. When in doubt, leave it out.

## Code style

- **Clarity over brevity.** Long, obvious names are better than short, opaque ones. Code should be self-explanatory. If a name alone can't convey the intent, consider abstracting to a function, or add a comment — but prefer renaming first. The goal is to improve readability and understanding.
- **Naming guidelines.** For every variable, function, parameter, and non-trivial expression, a new contributor should understand its purpose instantly. Apply these strategies in order of preference:
  1. **Rename** to something self-documenting (e.g. `p` → `pattern`, `msg` → `normalizedMessage`, `flags` → `showFileNames`).
  2. **Extract a named variable** when an inline expression hides intent (e.g. `mode & 0o077` → `const isAccessibleByGroupOrOthers = (mode & 0o077) !== 0`).
  3. **Extract a named function** when a block of logic deserves a descriptive name (e.g. `walkDir` → `listFilesRecursively`).
  4. **Add a comment** only as a last resort, when renaming or extraction cannot capture the "why" (e.g. explaining that `!` is preserved because fast-glob uses it for negation patterns).
- **No narration comments.** Never add comments that just restate what the code does. Comments should explain non-obvious intent, trade-offs, or constraints.

## Invariants

- **No symlinks, ever.** Files are copied to the backup repo. Originals are never touched.
- **No merge conflicts, ever.** Backup: local source files are the single source of truth — fetch + hard reset, then overwrite. Restore: remote repo is the single source of truth — same strategy, opposite direction.
- **Machines must never clobber each other.** Files live under `<repo>/<machine>/`. Two machines sharing a repo must remain fully isolated. Breaking this would be a critical bug.
- **Restore is self-bootstrapping.** The config file is always included in backups so `restore <url>` works on a blank machine with zero prior setup.
- **Non-destructive restore.** New files restore automatically. Existing files prompt before overwriting.

## Platform

- **macOS first.** Optimized for Mac, but should work on Linux and Windows too. Notable exception: scheduling (launchd) is macOS-only for now.

## Git providers

- **GitHub, GitLab, and Bitbucket.** Any provider that supports standard Git over HTTPS or SSH should work, but these three are the optimization targets.

## Scope

- **Git is the only backend.** Non-git backends: firm no.
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

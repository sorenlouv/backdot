# AGENTS.md

## Why this tool exists

The author lost a machine and with it irreplaceable files: SSH keys, shell history, years of zsh config, gitignored dev configs. Backdot ensures this never happens again by automatically backing up dotfiles and gitignored files to a Git repo.

Inspired by [mackup](https://github.com/lra/mackup), but mackup replaces files with symlinks — that's intrusive and has caused data loss. Backdot only copies; it never modifies or replaces originals.

## Principles

Fast, simple, beautiful. When in doubt, leave it out.

## Invariants

- **No symlinks, ever.** Files are copied to the backup repo. Originals are never touched.
- **No merge conflicts, ever.** Backup: local source files are the single source of truth — fetch + hard reset, then overwrite. Restore: remote repo is the single source of truth — same strategy, opposite direction.
- **Machines must never clobber each other.** Files live under `<repo>/<machine>/`. Two machines sharing a repo must remain fully isolated. Breaking this would be a critical bug.
- **Restore is self-bootstrapping.** The config file is always included in backups so `--restore <url>` works on a blank machine with zero prior setup.
- **Non-destructive restore.** New files restore automatically. Existing files prompt before overwriting.

## Scope

- **Git is the only backend.** Non-git backends: firm no.
- **macOS scheduling first.** Linux/Windows welcome if requested.
- The 10 MB file-size limit has no strong justification — can be raised or removed.
- Other features: consider if highly requested and/or simple to implement.

## Testing

```bash
npm test              # unit tests (vitest)
npm run test:e2e      # build + e2e
```

Override `HOME` to test without touching real config:

```bash
HOME=$(mktemp -d) node dist/cli.js --init
```

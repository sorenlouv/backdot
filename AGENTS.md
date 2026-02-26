# AGENTS.md

## Design principles

Every feature must be **fast**, **simple**, and **beautiful**. This tool solves one thing — backing up dotfiles and gitignored files — and does it exceptionally well. Resist scope creep. When in doubt, leave it out.

## Key architecture decisions

- The backup repo is cloned to `~/.backdot/repo`. Git sync uses fetch + hard reset (not merge) to avoid conflicts.
- Files are stored under `<repo>/<machine>/` preserving directory structure relative to `$HOME`. Files outside `$HOME` have the leading `/` stripped.
- The config file itself (`~/.backdot.json`) is always included in backups.
- Files >10 MB are silently skipped (this is a bug that should be fixed).

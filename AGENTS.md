# AGENTS.md

## Design principles

Every feature must be **fast**, **simple**, and **beautiful**. This tool solves one thing — backing up dotfiles and gitignored files — and does it exceptionally well. Resist scope creep. When in doubt, leave it out.

## Requirements

- **Backup** resolves files from two sources (gitignored dirs via `git ls-files`, glob patterns via `fast-glob`), copies them to a local staging repo, and pushes to a remote Git repo. The config file (`~/.backdot.json`) is always included.
- **Restore** pulls the backup repo, restores new files automatically, and prompts (interactive checkbox) before overwriting existing files.
- **Status** compares local files against the remote backup using git object hashes and reports which files are backed up, modified, or not yet backed up.
- **Schedule/Unschedule** installs or removes a macOS launchd job for daily automatic backups.
- **Multi-machine** support: files are stored under `<repo>/<machine>/` so one repo can back up multiple machines.
- Files >10 MB are skipped. Files outside `$HOME` are stored with the leading `/` stripped.
- On backup success, a clickable commit URL (GitHub/GitLab/Bitbucket) is shown to the user.

## Key architecture decisions

- The backup repo is cloned to `~/.backdot/repo`. Git sync uses fetch + hard reset (not merge) to avoid conflicts.
- `compareFiles` (used by `--status`) compares git object hashes from the remote tree against hashes of local source files — no local checkout needed.

## Manual testing

Override `HOME` to a temp directory to test any command without touching your real config or backup repo:

```bash
HOME=$(mktemp -d) node dist/cli.js --init
```

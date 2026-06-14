# Backdot Specification

## Purpose and Motivation

The author lost a machine and with it irreplaceable files: SSH keys, shell history, years of zsh config, gitignored dev configs. Backdot ensures this never happens again by automatically backing up dotfiles and other important files to a private Git repo.

Inspired by [mackup](https://github.com/lra/mackup), but mackup replaces files with symlinks -- that's intrusive and has caused data loss. Backdot only copies; it never modifies or replaces originals.

The target user is an individual developer who wants to back up personal config files (dotfiles, SSH keys, editor settings, shell history) and be able to restore them on a new or rebuilt machine.

## Core Concepts

**Config file** (`~/.backdot/config.json`) has four fields:

| Field        | Required | Description                                      |
| ------------ | -------- | ------------------------------------------------ |
| `repository` | yes      | Git remote URL (SSH or HTTPS)                    |
| `machine`    | yes      | Name for this machine (e.g. `my-work-laptop`)    |
| `paths`      | yes      | Array of glob patterns matching files to back up |
| `encrypt`    | no       | `true` to encrypt files before pushing           |

**Machine isolation.** Each machine's files are stored under a `<machine>/` directory in the repo. Two machines sharing the same repo must never interfere with each other. Breaking this isolation would be a critical bug.

**Config always backed up.** `~/.backdot/config.json` is automatically included in every backup so that `restore` works on a blank machine with zero prior setup.

## Commands

### `init`

Creates `~/.backdot/config.json` with sensible defaults. Never overwrites an existing config. Shows deep links to create a private repo on GitHub, GitLab, and Bitbucket, and prints next-step commands.

### `backup`

Resolves files from config, refuses if the repo is public, syncs with the remote, optionally encrypts, and pushes changes. Shows a clickable commit URL on success (GitHub, GitLab, or Bitbucket). If no files are resolved, exits early with a message.

### `restore [url]`

Works with or without an existing config:

- **With config:** uses the configured repo and machine.
- **With a URL argument:** clones the repo and discovers available machines. If multiple machines exist, the user picks one interactively (or names one with `--machine`). This makes restore self-bootstrapping on a blank machine, with no pre-existing config required.

Files are shown in an interactive picker:

- New files (not present locally) default to **selected**.
- Existing files (already on disk) default to **unselected**, to prevent accidental overwrites.

Options:

- `--machine <name>` selects which machine to restore, without the interactive picker. Required when multiple machines exist and there is no interactive terminal (otherwise restore errors and lists the available machines). If the name is unknown, restore fails and lists the available machines. With a config, `--machine` overrides the configured machine; the repository still comes from config.
- `--commit <sha>` restores from a specific earlier backup.
- `--yes` (`-y`) accepts defaults without prompting. With `--yes`, only new files are restored; existing files are skipped.

### `history [url]`

Lists recent backups, lets the user pick one, then restores from that commit.

### `status`

Shows: schedule state, repo URL, machine name, encryption status, repo visibility (public/private/unknown), and a per-file comparison against the remote (backed up / modified since last backup / not yet backed up).

Useful before the first backup: with no config it nudges the user to run `init`; with a config but nothing backed up yet it previews every resolved file as "not yet backed up" instead of erroring.

### `schedule`

Sets up automatic daily backup (macOS only). Backups run daily at 02:00. Re-running `schedule` updates the existing schedule. Warns if encryption is enabled but no key file exists.

### `unschedule`

Removes the scheduled daily backup.

### (no arguments)

Shows help. Nudges toward `init` if no config file exists.

## Git Strategy

**No merge conflicts, ever.** Backup: local files are the single source of truth -- the remote is overwritten. Restore: the remote is the single source of truth -- local files are overwritten (with user consent).

**Concurrent multi-machine safety.** Multiple machines backing up to the same repo simultaneously must all succeed. This works because each machine writes to its own subdirectory.

**Commit messages** are descriptive, listing changed filenames, and gracefully shortened when too long.

**Friendly error messages.** Git errors (repo not found, auth failed, network down) are translated to actionable, user-readable messages.

**Config changes take effect immediately.** If the user changes the repository URL in config, the next operation uses the new URL without manual intervention.

## File Resolution

- `paths` entries are glob patterns. Dot-files (e.g. `~/.zshrc`) are matched. Only regular files are included.
- Prefix a pattern with `!` to exclude matching files (e.g. `!~/.config/app/secret.key`).
- `~` is expanded to the user's home directory, including inside negation patterns.
- Unreadable files and files larger than 10 MB are silently skipped (logged as warnings).
- Duplicate matches are deduplicated. The key file (`~/.backdot/encryption.key`) is always excluded.

## Encryption

- Opt-in via `"encrypt": true`. Files are encrypted before pushing so sensitive data is protected if the repo is compromised.
- Password lookup: `~/.backdot/encryption.key` file > interactive prompt. Non-interactive mode without a password fails with a clear error.
- On first backup the user is prompted to confirm the password and offered to save it to `~/.backdot/encryption.key`. On subsequent backups the password is verified against the repo before proceeding.
- The key file requires restrictive permissions (no group/other access) and is never included in backups -- if the user loses their machine they must remember the password to restore.

## Repository Visibility Check

- Before each backup, the repo is checked for public accessibility. Backup is refused if the repo is public, to prevent accidental exposure of sensitive files.
- Visibility detection works for GitHub, GitLab, and Bitbucket. For other hosts, visibility is reported as "unknown" and backup is allowed.
- `status` shows the repo's visibility.

## File Layout in the Backup Repo

Each machine's files live under `<machine>/` in one of two namespaces, which keeps the layout lossless and lets restore put every file back in the right place:

- Files under HOME are stored at `<machine>/home/<path-relative-to-HOME>` (e.g. `my-laptop/home/.zshrc`). On restore they are written relative to the _restoring_ machine's HOME, so dotfiles stay portable across machines with different home paths.
- Files outside HOME are stored at `<machine>/root/<absolute-path-minus-leading-slash>` (e.g. `/etc/foo` becomes `my-laptop/root/etc/foo`). On restore they are written back to their original absolute path.
- Each backup is a complete snapshot of the configured files: the `home/` and `root/` namespaces are fully rebuilt every backup, so files removed from the config are removed from the repo. Any other file you add under `<machine>/` -- e.g. a hand-written `README.md` with machine-specific restore notes -- is left untouched and survives across backups; `restore` ignores it (only `home/` and `root/` are restored).
- A `README.md` is written at the repo root with restore instructions (an `npx backdot restore <repo> --machine <machine>` one-liner) and a pointer to each machine's own `README.md`.

## Post-restore hook

An optional `~/.backdot/post-restore` script lets a restored machine provision itself (install packages, clone repos, etc.).

- It is an ordinary backed-up file: if it exists, it is automatically included in every backup (like the config file), so it travels with the repo.
- After `restore` copies files, if the hook was among the files just restored, it is executed once with POSIX `sh` (`/bin/sh ~/.backdot/post-restore`) from the home directory, with output streamed live. It runs only when freshly restored — never a stale on-disk copy the user chose not to restore.
- A non-zero exit is surfaced as an error (with the exit code) and fails the command; the files themselves were already restored. Not supported on Windows (skipped with a message).
- The script is code stored in your backup repo and runs with your user privileges — keep the repo private (backup already refuses public repos).

## Notifications

On macOS, a system notification is shown when a scheduled (background) backup fails, so the user is alerted even when no terminal is visible.

## Logging

All operations are logged to `~/.backdot/logs/cli.log` for debugging.

## Scheduling

- macOS only (uses launchd). Running `schedule` on other platforms fails with a message suggesting cron or systemd.
- Backups run daily at 02:00. Re-running `schedule` updates the existing schedule.

## Invariants

These behaviors are intentional and must be preserved:

- **No symlinks, ever.** Files are copied to the backup repo. Originals are never touched.
- **No merge conflicts, ever.** See Git Strategy above.
- **Machine isolation.** Two machines sharing a repo must never clobber each other's files.
- **Config always included in backup.** This enables self-bootstrapping restore on a blank machine.
- **Non-destructive restore.** New files are auto-selected; existing files require explicit opt-in. `--yes` skips existing files entirely.
- **Key file never backed up.** The encryption password file is always excluded from backups.
- **Public repo backup refused.** Backup is blocked when the repo is publicly accessible.

## Explicitly Removed Features

These features existed in earlier versions and were intentionally removed. Do not reintroduce them.

- **Automatic gitignored file discovery.** An earlier version had a `gitignored` config option that auto-discovered gitignored files. It was removed as too implicit and noisy. Users should list files explicitly in `paths` instead.
- **Nested config schema.** An earlier version used `files.gitignored` / `files.match`. This was flattened to top-level `paths` for simplicity.

## Supported Git Providers

GitHub, GitLab, and Bitbucket. Any provider that supports standard Git over HTTPS or SSH should work, but these three are the optimization targets.

## Platform

macOS first. Should work on Linux and Windows too, with the exception of scheduling (launchd is macOS-only).

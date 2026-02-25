# backdot

Lightweight CLI to back up dotfiles and gitignored files to a private Git repo, with optional daily scheduling via macOS launchd.

## How it works

1. Reads `~/.backdot.json` for the target repository and file entries
2. Resolves file entries — either gitignored files in a directory or glob patterns
3. Copies resolved files to `~/.backdot/repo/`, preserving directory structure relative to `~`
4. Commits and pushes changes to the configured remote

## Installation

```bash
npm install -g backdot
```

Requires Node.js and `git` available on your PATH.

## Configuration

Create `~/.backdot.json`:

```json
{
  "repository": "git@github.com:USERNAME/dotfiles-backup.git",
  "files.gitignored": ["~/my-project"],
  "files.match": ["~/.zshrc", "~/.config/ghostty/**"]
}
```

### File entry types

| Key                | Description                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `files.gitignored` | Array of directories. Backs up all gitignored files in each directory (runs `git ls-files --others --ignored --exclude-standard`) |
| `files.match`      | Array of glob patterns. Backs up all matching files (powered by [fast-glob](https://github.com/mrmlnc/fast-glob))                 |

Both keys are optional, but at least one must be present and non-empty. Paths support `~` expansion.

## Usage

### Run a backup

```bash
backdot --backup
```

### Restore from backup

```bash
backdot --restore
```

Pulls the latest state from the remote backup repo and copies files back to their original locations. If any files already exist, you'll be prompted to select which ones to overwrite.

### Schedule daily backups (macOS)

```bash
backdot --schedule
```

Installs a launchd job (`com.backdot.daemon`) that runs the backup daily at 02:00.

### Remove the schedule

```bash
backdot --unschedule
```

### Check status

```bash
backdot --status
```

Shows whether the daily schedule is active and lists all files that would be backed up. Useful for verifying your `~/.backdot.json` is correct.

## File locations

| Path                                              | Purpose                                |
| ------------------------------------------------- | -------------------------------------- |
| `~/.backdot.json`                                 | Configuration file                     |
| `~/.backdot/repo/`                                | Local staging directory (the git repo) |
| `~/.backdot/backup.log`                           | Backup log                             |
| `~/Library/LaunchAgents/com.backdot.daemon.plist` | launchd job (when using `--schedule`)  |

## Development

```bash
npm install
npm run build
npm start
```

## License

MIT

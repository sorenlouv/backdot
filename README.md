<p align="center">
  <img src="logo-small.png" alt="backdot" width="400" />
</p>

<h1 align="center">backdot</h1>

<p align="center">Automated backup of important files (configs, dotfiles) to your own private Git repo.</p>

## Getting started

```bash
npm install -g backdot
backdot init
```

This creates `~/.backdot/config.json` with sensible defaults and walks you through setup. Open the config file and set your repository URL and the files you want backed up:

```json
{
  "repository": "git@github.com:USERNAME/backdot-backup.git",
  "machine": "my-work-laptop",
  "paths": ["~/.zshrc", "~/.oh-my-zsh/custom/*.zsh", "~/.ssh/config", "~/.npmrc"]
}
```

Run your first backup:

```bash
backdot backup
```

or configure the backport process to run automatically (daily at 2am)

```bash
backdot schedule
```

## Configuration

| Key     | Description                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------- |
| `paths` | Glob patterns matching files. To back up a whole directory, use a trailing `/**` (e.g. `~/.config/nvim/**`) — a bare directory path matches nothing. |

Prefix a pattern with `!` to exclude matching files:

```json
{
  "paths": ["~/.config/ghostty/**", "!~/.config/ghostty/crash-reports/**"]
}
```

## Encryption

To encrypt files before they are pushed to the remote repo, add `"encrypt": true` to your config.

On first backup you'll be prompted for a password and offered to save it to `~/.backdot/encryption.key` so that future backups do not prompt for a password.

For non-interactive backups (the scheduled job, CI, etc.) you can supply the password via the `BACKDOT_PASSWORD` environment variable instead of the key file.

## Post-restore hook

Add a `~/.backdot/post-restore` shell script which will be executed after `backdot restore`to install packages, clone repos, etc. It's backed up automatically.

## Commands

| Command                        | Description                                    |
| ------------------------------ | ---------------------------------------------- |
| `init`                         | Set up backdot for the first time              |
| `backup`                       | Run a backup now                               |
| `restore`                      | Restore latest backup from the configured repo |
| `restore <url>`                | Restore from a specific repo URL               |
| `restore [url] --commit <sha>` | Restore from a specific backup commit          |
| `restore [url] --machine <name>` | Restore a specific machine non-interactively |
| `restore [url] --yes` (`-y`)   | Restore new files non-interactively (skips existing files) |
| `history [url]`                | Browse and restore a previous backup           |
| `schedule`                     | Schedule automatic daily backup (Mac-only)     |
| `unschedule`                   | Unschedule the daily backup                    |
| `status`                       | Show schedule and resolved file list           |

## Development

```bash
cd cli
npm install
npm run build
npm start
```

## License

MIT

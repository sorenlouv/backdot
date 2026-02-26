<p align="center">
  <img src="logo-small.png" alt="backdot" width="400" />
</p>

<h1 align="center">backdot</h1>

<p align="center">Automated backup of important files (configs, dotfiles, gitignored files) to your own private Git repo.</p>

## Getting started

```bash
npm install -g backdot
backdot --init
```

This creates `~/.backdot.json` with sensible defaults and walks you through setup. Open the config file and set your repository URL and the files you want backed up:

```json
{
  "repository": "git@github.com:USERNAME/backdot-backup.git",
  "machine": "my-work-laptop",
  "gitignored": ["~/my-project"],
  "paths": ["~/.zshrc", "~/.oh-my-zsh/custom/*.zsh", "~/.ssh/config", "~/.npmrc"]
}
```

Run your first backup:

```bash
backdot --backup
```

## Configuration

| Key          | Description                                            |
| ------------ | ------------------------------------------------------ |
| `gitignored` | Directories to scan for gitignored files               |
| `paths`      | Glob patterns matching individual files or directories |

## Commands

| Command        | Description                                            |
| -------------- | ------------------------------------------------------ |
| `--init`       | Set up backdot for the first time                      |
| `--backup`     | Run a backup now                                       |
| `--restore`    | Restore files to their original locations              |
| `--schedule`   | Schedule automatic daily backup via launchd (Mac-only) |
| `--unschedule` | Remove the daily schedule                              |
| `--status`     | Show schedule and resolved file list                   |

## Development

```bash
npm install
npm run build
npm start
```

## License

MIT

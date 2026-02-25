<p align="center">
  <img src="logo-small.png" alt="backdot" width="400" />
</p>

<h1 align="center">backdot</h1>

<p align="center">Back up dotfiles and gitignored files to a private Git repo — on demand or on a daily schedule.</p>

## Getting started

```bash
npm install -g backdot
```

Create `~/.backdot.json` pointing to a private repo and the files you want backed up:

```json
{
  "repository": "git@github.com:USERNAME/dotfiles-backup.git",
  "machine": "my-work-laptop",
  "files.gitignored": ["~/my-project"],
  "files.match": ["~/.zshrc", "~/.oh-my-zsh/custom/*.zsh", "~/.ssh/config/config", "~/.npmrc"]
}
```

Run your first backup:

```bash
backdot --backup
```

## Configuration

| Key                | Description                                            |
| ------------------ | ------------------------------------------------------ |
| `files.gitignored` | Directories to scan for gitignored files               |
| `files.match`      | Glob patterns matching individual files or directories |

## Commands

| Command        | Description                                            |
| -------------- | ------------------------------------------------------ |
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

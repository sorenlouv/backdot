# Development

## Prerequisites

- Node.js 22+
- npm
- [GitHub CLI](https://cli.github.com/) (`gh`) — needed for releasing

## Getting Started

```bash
git clone https://github.com/sorenlouv/backdot.git
cd backdot
npm install
npm run build
```

## Scripts

| Command               | Description                          |
| --------------------- | ------------------------------------ |
| `npm run build`       | Compile TypeScript to `dist/`        |
| `npm run build:watch` | Compile in watch mode                |
| `npm start`           | Run the built CLI (`dist/cli.js`)    |
| `npm run lint`        | Lint with ESLint                     |
| `npm run lint:fix`    | Lint and auto-fix                    |
| `npm run format`      | Format with Prettier                 |
| `npm run format:check`| Check formatting without writing     |
| `npm test`            | Run unit tests                       |
| `npm run test:e2e`    | Build, then run end-to-end tests     |
| `npm run test:watch`  | Run tests in watch mode              |

## Testing

Unit tests live next to source files (`src/*.test.ts`) and run with Vitest.

```bash
npm test
```

End-to-end tests (`src/e2e.test.ts`) exercise the built CLI in isolated temp directories with `HOME` overridden, so they never touch your real config. They use local bare git repos — no network access required.

```bash
npm run test:e2e
```

You can also test the CLI manually against a throwaway home directory:

```bash
HOME=$(mktemp -d) node dist/cli.js --init
```

## Releasing

Releases are done locally via the release script. You need `npm` auth and the GitHub CLI (`gh`) installed and authenticated.

```bash
npm run release
```

What the script does:

1. Verifies npm auth and `gh` CLI
2. Checks you're on `main` with a clean working tree
3. Builds, lints, and runs unit tests
4. Prompts you to pick `patch`, `minor`, or `major`
5. Bumps the version via `npm version` (creates a git tag)
6. Publishes to npm
7. Pushes the commit and tag to GitHub
8. Creates a GitHub release with auto-generated notes

## CI

A single GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push to `main` and on pull requests targeting `main`.

It runs the following checks on Node 22:

1. Lint (`eslint`)
2. Format check (`prettier --check`)
3. Build (`tsc`)
4. Unit tests
5. End-to-end tests

No secrets or manual setup are required — it works out of the box.

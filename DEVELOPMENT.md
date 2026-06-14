# Development

## Prerequisites

- Node.js 22+
- npm

## Getting Started

The npm package lives in `cli/`, so run all npm commands from there.

```bash
git clone https://github.com/sorenlouv/backdot.git
cd backdot/cli
npm install
npm run build
```

## Scripts

| Command                | Description                       |
| ---------------------- | --------------------------------- |
| `npm run build`        | Compile TypeScript to `dist/`     |
| `npm run build:watch`  | Compile in watch mode             |
| `npm start`            | Run the built CLI (`dist/cli.js`) |
| `npm run lint`         | Lint with ESLint                  |
| `npm run lint:fix`     | Lint and auto-fix                 |
| `npm run fmt`          | Format with Prettier              |
| `npm run fmt:check`    | Check formatting without writing  |
| `npm test`             | Run unit tests                    |
| `npm run test:e2e`     | Build, then run end-to-end tests  |
| `npm run test:watch`   | Run tests in watch mode           |

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
HOME=$(mktemp -d) node dist/cli.js init
```

## Releasing

Releases are fully automated — **there is no local release step**. Every merge to `main` publishes a new **patch** version to npm via GitHub Actions, using npm [Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). No npm token is stored anywhere; the workflow authenticates to npm through GitHub's OIDC identity and attaches build provenance automatically.

On each push to `main`, the `publish` job in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

1. Waits for the `check` job (lint, format, build, unit/integration/e2e tests) to pass.
2. Bumps the patch version with `npm version patch`, creating a commit + `vX.Y.Z` tag (the commit is marked `[skip ci]` so it doesn't re-trigger the workflow).
3. Pushes the bump commit and tag to `main`.
4. Publishes to npm, then creates a GitHub release with auto-generated notes.

### Cutting a minor or major release

The bump type is only automatic for patches. For a minor or major, trigger the workflow manually:

**GitHub → Actions → CI → Run workflow → set _release_type_ to `minor` or `major`** (run it from the `main` branch).

It runs the same pipeline with the chosen bump.

### One-time npm setup (required before the first automated release)

Trusted Publishing must be configured once on npm by the package owner:

1. npmjs.com → the [`backdot`](https://www.npmjs.com/package/backdot) package → **Settings → Trusted Publishing**.
2. Add a **GitHub Actions** publisher with:
   - **Organization or user:** `sorenlouv`
   - **Repository:** `backdot`
   - **Workflow filename:** `ci.yml`
   - **Environment:** _(leave blank)_

The package must already exist on npm (it does — `backdot@1.8.1`), and no `NPM_TOKEN` secret is needed.

## CI

The GitHub Actions workflow ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push to `main` and on pull requests targeting `main`. The `check` job runs on Node 22:

1. Lint (`eslint`)
2. Format check (`prettier --check`)
3. Build (`tsc`)
4. Unit tests
5. Integration tests
6. End-to-end tests

On pushes to `main` (and manual `Run workflow` triggers) the `publish` job runs after `check` passes — see [Releasing](#releasing) above. Pull requests run `check` only.

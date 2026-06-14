# Building Backdot

## Prerequisites

- **Node.js** >= 18 ([nodejs.org](https://nodejs.org))
- **Git**

## CLI

The CLI is a standalone Node.js application in `cli/`.

```bash
cd cli
npm ci
npm run build
```

This compiles TypeScript to `cli/dist/`. Run the CLI directly with:

```bash
node dist/cli.js --help
```

### Testing

```bash
npm test          # unit tests
npm run test:all  # build + all tests (unit, integration, e2e)
```

### Watch mode

```bash
npm run build:watch
```
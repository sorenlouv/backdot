#!/usr/bin/env bash
set -euo pipefail

# ── Prerequisites ────────────────────────────────────────────────────────────

echo "Verifying npm auth…"
npm login

if ! command -v gh &>/dev/null; then
  echo "Error: GitHub CLI (gh) is not installed."
  echo "Install it with:  brew install gh"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "Error: GitHub CLI is not authenticated."
  echo "Run:  gh auth login"
  exit 1
fi

# ── Guards ───────────────────────────────────────────────────────────────────

branch=$(git branch --show-current)
if [[ "$branch" != "main" ]]; then
  echo "Error: you must be on the 'main' branch to release (currently on '$branch')."
  exit 1
fi

if [[ -n $(git status --porcelain) ]]; then
  echo "Error: working tree is dirty. Commit or stash your changes first."
  exit 1
fi

# ── Build & Validate ────────────────────────────────────────────────────────

echo "Building…"
npm run build

echo "Linting…"
npm run lint

echo "Running tests…"
npm run test

# ── Version Bump ─────────────────────────────────────────────────────────────

echo ""
echo "Select release type:"
select RELEASE_TYPE in patch minor major; do
  if [[ -n "$RELEASE_TYPE" ]]; then
    break
  fi
  echo "Invalid selection. Please choose 1, 2, or 3."
done

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

npm version "$RELEASE_TYPE"

NEW_VERSION=$(node -p "require('./package.json').version")
echo "Bumped to: $NEW_VERSION"

# ── Publish to npm ───────────────────────────────────────────────────────────

echo "Publishing to npm…"
npm publish

# ── Push to GitHub ───────────────────────────────────────────────────────────

echo "Pushing to GitHub…"
git push
git push --tags

# ── Create GitHub Release ────────────────────────────────────────────────────

echo "Creating GitHub release…"
gh release create "v$NEW_VERSION" --generate-notes

# ── Summary ──────────────────────────────────────────────────────────────────

echo ""
echo "Release v$NEW_VERSION complete!"
echo "  npm: https://www.npmjs.com/package/backdot/v/$NEW_VERSION"
echo "  GitHub: $(gh release view "v$NEW_VERSION" --json url --jq '.url')"

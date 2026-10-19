#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Checking GitHub login..."
if ! gh auth status >/dev/null 2>&1; then
  echo "Not logged in. Starting device login..."
  echo "A code will appear below. Enter it at https://github.com/login/device in Chrome."
  gh auth login -h github.com -p https -w -s repo
fi

USER="$(gh api user -q .login)"
REPO="sarabyx-pipeline"
echo "==> Logged in as: $USER"

# Commit README tweak if needed
if ! git diff --quiet README.md 2>/dev/null; then
  git add README.md
  git commit -m "docs: set clone URL for public repo" || true
fi

# Update clone URL in README to real user
if grep -q 'sabysingh299-oss/sarabyx-pipeline\|OWNER/REPO' README.md 2>/dev/null; then
  sed -i '' "s|https://github.com/[^/]*/sarabyx-pipeline.git|https://github.com/${USER}/sarabyx-pipeline.git|g" README.md || true
  if ! git diff --quiet README.md; then
    git add README.md
    git commit -m "docs: point clone URL at ${USER}/sarabyx-pipeline" || true
  fi
fi

# Safety: refuse if secrets would be pushed
if git ls-files | grep -E '\.env$|settings\.json$|content\.csv$|chrome-profile|aeo-tips'; then
  echo "ERROR: secret-like files tracked. Aborting."
  exit 1
fi

if gh repo view "$USER/$REPO" >/dev/null 2>&1; then
  echo "==> Repo exists, setting remote..."
  git remote remove origin 2>/dev/null || true
  git remote add origin "https://github.com/${USER}/${REPO}.git"
else
  echo "==> Creating public repo ${USER}/${REPO}..."
  gh repo create "$REPO" --public --source=. --remote=origin --description "Local Instagram + LinkedIn posting pipeline — AI drafts, human approve, post in Chrome"
fi

git branch -M main
git push -u origin main

echo ""
echo "Live at: https://github.com/${USER}/${REPO}"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> Pipeline setup"
echo "    $ROOT"
echo "    Needs: Node.js 20+ and Google Chrome"
echo "    No API keys or logins are bundled — you add your own."

# Fresh local config (never copy secrets from anywhere)
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "==> Created .env (optional — you can also paste the API key in Settings)"
fi

mkdir -p data browser/media sheet dist

if [[ ! -f sheet/content.csv ]]; then
  cp sheet/content.example.csv sheet/content.csv
  echo "==> Created starter sheet/content.csv"
fi

if [[ ! -f data/connections.json ]]; then
  cp data/connections.example.json data/connections.json
fi

if [[ ! -f data/chrome-control.json ]]; then
  printf '%s\n' '{"enabled":false}' > data/chrome-control.json
fi

# Never seed settings.json — user adds API key in the UI
if [[ -f data/settings.json ]]; then
  echo "==> Found existing data/settings.json (kept — your local key stays on this machine)"
else
  echo "==> No settings yet — add your API key in the UI after start"
fi

echo "==> Installing dependencies"
cd "$ROOT/browser"
npm install --omit=dev

echo ""
echo "Setup complete. Nothing from a previous machine is included."
echo ""
echo "Next:"
echo "  1) ./scripts/start-ui.sh"
echo "  2) Open http://127.0.0.1:3920"
echo "  3) Settings → paste your API key → Save → Test model"
echo "  4) Connections → Enable Chrome control → sign into Instagram/LinkedIn"
echo ""

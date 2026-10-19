#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

if [[ ! -f sheet/content.csv ]]; then
  cp sheet/content.example.csv sheet/content.csv
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

if [[ ! -d "$ROOT/browser/node_modules" ]]; then
  echo "First run — installing dependencies…"
  ./scripts/setup.sh
fi

PORT="${POSTER_PORT:-3920}"
mkdir -p data browser/media

if [[ ! -f data/connections.json ]]; then
  cp data/connections.example.json data/connections.json
fi

if lsof -ti tcp:"$PORT" >/dev/null 2>&1; then
  echo "==> Stopping existing Pipeline server on :$PORT"
  lsof -ti tcp:"$PORT" | xargs kill 2>/dev/null || true
  sleep 0.4
fi

echo "==> Pipeline → http://127.0.0.1:${PORT}"
echo "    Add your API key in Settings. Everyday Chrome is not modified."
cd "$ROOT/browser"
exec node poster-server.mjs

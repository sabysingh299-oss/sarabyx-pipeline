#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# shellcheck disable=SC1091
set -a
source .env
set +a

mkdir -p data/n8n

echo "==> Starting poster service (browser automation) on :${POSTER_PORT:-3920}"
cd "$ROOT/browser"
if [[ ! -d node_modules ]]; then
  echo "Dependencies missing. Run ./scripts/setup.sh first."
  exit 1
fi

node poster-server.mjs &
POSTER_PID=$!
cd "$ROOT"

cleanup() {
  echo ""
  echo "==> Stopping poster service ($POSTER_PID)"
  kill "$POSTER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starting n8n (open source) on :${N8N_PORT:-5678}"
echo "    Editor: ${N8N_EDITOR_BASE_URL:-http://localhost:5678}"
echo "    Approvals: http://127.0.0.1:${POSTER_PORT:-3920}/approvals"
echo ""

if command -v docker >/dev/null 2>&1; then
  docker compose up
else
  echo "Docker not found. Install Docker Desktop, or run n8n another way."
  echo "Poster service is running alone for now (PID $POSTER_PID)."
  wait "$POSTER_PID"
fi

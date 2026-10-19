#!/usr/bin/env bash
# Build a clean zip anyone can download — no keys, profiles, or personal data.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NAME="sarabyx-pipeline"
STAMP="$(date +%Y%m%d)"
OUT_DIR="$ROOT/dist"
STAGE="$OUT_DIR/${NAME}-clean"
ZIP="$OUT_DIR/${NAME}-${STAMP}.zip"

rm -rf "$STAGE"
mkdir -p "$STAGE"

echo "==> Staging clean release (no secrets, no profiles, no local sheet)"

# Copy project files with exclusions
rsync -a \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'browser/node_modules' \
  --exclude 'browser/profiles' \
  --exclude 'browser/media/*' \
  --exclude 'data/settings.json' \
  --exclude 'data/connections.json' \
  --exclude 'data/chrome-control.json' \
  --exclude 'data/chrome-profile' \
  --exclude 'data/n8n' \
  --exclude 'sheet/content.csv' \
  --exclude 'sheet/content.local.csv' \
  --exclude '.env' \
  --exclude 'dist' \
  --exclude 'references' \
  --exclude '.impeccable' \
  --exclude '.DS_Store' \
  --exclude '*.log' \
  --exclude '*.zip' \
  "$ROOT/" "$STAGE/"

# Ensure starter media folder exists empty
mkdir -p "$STAGE/browser/media" "$STAGE/data" "$STAGE/sheet"
touch "$STAGE/browser/media/.gitkeep" "$STAGE/data/.gitkeep"
cp "$ROOT/sheet/content.example.csv" "$STAGE/sheet/content.example.csv"
cp "$ROOT/data/connections.example.json" "$STAGE/data/connections.example.json"
# Do not include a pre-made content.csv — setup creates it from the example
rm -f "$STAGE/sheet/content.csv"
# Guarantee empty .env is not present
rm -f "$STAGE/.env"
# Strip any accidental settings
rm -f "$STAGE/data/settings.json"

# Safety scan: fail if a real secret leaked (ignore empty placeholders)
if rg -n --hidden \
  -g '!.env.example' \
  -g '!*.example.*' \
  -g '!pack-release.sh' \
  -e 'sk-[A-Za-z0-9]{20,}' \
  -e 'AI_API_KEY=[^[:space:]]+' \
  -e 'aiApiKey"[[:space:]]*:[[:space:]]*"[^"]{8,}' \
  "$STAGE" 2>/dev/null; then
  echo "ERROR: Possible secret found in staged release. Aborting."
  exit 1
fi

# Confirm no chrome profile / settings
if [[ -d "$STAGE/data/chrome-profile" ]] || [[ -f "$STAGE/data/settings.json" ]] || [[ -f "$STAGE/.env" ]]; then
  echo "ERROR: Local runtime files still present in stage."
  exit 1
fi

rm -f "$ZIP"
(
  cd "$OUT_DIR"
  zip -rq "$(basename "$ZIP")" "$(basename "$STAGE")"
)

echo ""
echo "Clean package ready:"
echo "  $ZIP"
echo ""
echo "Recipients only need to:"
echo "  unzip → ./scripts/setup.sh → ./scripts/start-ui.sh → paste API key in Settings"
echo ""

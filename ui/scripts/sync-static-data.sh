#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_DIR="$UI_DIR/public/data"
LOG_FILE="${TMPDIR:-/tmp}/easy_llm_ui_sync_api.log"

mkdir -p "$OUTPUT_DIR"

cd "$UI_DIR"
echo "Starting local API for snapshot sync..."
npm run start:api >"$LOG_FILE" 2>&1 &
API_PID=$!

cleanup() {
  kill "$API_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

for _ in {1..30}; do
  if curl -sSf "http://localhost:8787/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -sSf "http://localhost:8787/api/config" | jq '.config' >"$OUTPUT_DIR/config.json"
curl -sSf "http://localhost:8787/api/dashboard" >"$OUTPUT_DIR/dashboard.json"

echo "Snapshot data updated:"
echo "- $OUTPUT_DIR/config.json"
echo "- $OUTPUT_DIR/dashboard.json"

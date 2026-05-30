#!/usr/bin/env bash
#
# Build a Firefox-ready .zip from the contents of extension/.
#
# The single manifest.json works in both Chrome and Firefox because each
# browser ignores fields it does not understand:
#   - background.service_worker  → used by Chrome MV3 (and Firefox 121+)
#   - background.scripts         → used by Firefox MV3 event-page model
#   - browser_specific_settings  → used by Firefox; ignored by Chrome
#
# We zip the CONTENTS of extension/, not the folder itself, so that
# manifest.json sits at the root of the archive — AMO requires this.
#
# Usage: bash scripts/build-firefox.sh
# Output: dist/learnwithsoju-firefox-<version>.zip

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/extension"
DIST="$ROOT/dist"

if [ ! -f "$SRC/manifest.json" ]; then
  echo "error: $SRC/manifest.json not found" >&2
  exit 1
fi

VERSION="$(grep -E '"version"\s*:' "$SRC/manifest.json" | head -1 | sed -E 's/.*"version"\s*:\s*"([^"]+)".*/\1/')"
if [ -z "$VERSION" ]; then
  echo "error: could not read version from manifest.json" >&2
  exit 1
fi

mkdir -p "$DIST"
OUT="$DIST/learnwithsoju-firefox-$VERSION.zip"
rm -f "$OUT"

echo "Building Firefox zip: $OUT"

# Lint with web-ext if installed (optional — install via `npm i -g web-ext`).
if command -v web-ext >/dev/null 2>&1; then
  echo "Running web-ext lint…"
  ( cd "$SRC" && web-ext lint --self-hosted ) || {
    echo "warning: web-ext lint reported issues (continuing build)" >&2
  }
else
  echo "note: web-ext not installed — skipping lint. Install with 'npm i -g web-ext' for local validation."
fi

# Zip the CONTENTS of extension/ so manifest.json is at the root of the archive.
# -r recurse, -q quiet, -X strip extra OS attributes for reproducibility.
( cd "$SRC" && zip -r -q -X "$OUT" . -x '*.DS_Store' '__MACOSX/*' '*.swp' )

echo "Built $OUT"
echo "Contents:"
unzip -l "$OUT" | head -20

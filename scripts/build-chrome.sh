#!/usr/bin/env bash
#
# Build a Chrome Web Store-ready .zip from the contents of extension/.
#
# The single manifest.json works in both Chrome and Firefox; Chrome MV3
# uses background.service_worker and ignores background.scripts +
# browser_specific_settings.
#
# We zip the CONTENTS of extension/, not the folder itself, so that
# manifest.json sits at the root of the archive — the Web Store requires this.
#
# Usage: bash scripts/build-chrome.sh
# Output: dist/learnwithsoju-chrome-<version>.zip

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
OUT="$DIST/learnwithsoju-chrome-$VERSION.zip"
rm -f "$OUT"

echo "Building Chrome zip: $OUT"

# Zip the CONTENTS of extension/ so manifest.json is at the root of the archive.
( cd "$SRC" && zip -r -q -X "$OUT" . -x '*.DS_Store' '__MACOSX/*' '*.swp' )

echo "Built $OUT"
echo "Contents:"
unzip -l "$OUT" | head -20

#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/web"
npm install --no-audit --no-fund
npm run build
rm -rf "$ROOT/src/pallas_community_stats/hub_static"
mkdir -p "$ROOT/src/pallas_community_stats/hub_static"
cp -a dist/. "$ROOT/src/pallas_community_stats/hub_static/"

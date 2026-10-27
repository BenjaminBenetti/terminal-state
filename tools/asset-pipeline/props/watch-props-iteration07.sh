#!/usr/bin/env bash
# Lane P2 (iteration 07): rebuild p7 runtime derivatives whenever Lane P1's ledger changes (resumable; the builder skips up-to-date
# types). Logs to .cache/iteration07-p2-build.log. Stops by itself after $1 seconds (default 7000) or when P1's ledger reports the
# batch finished and everything complete is built. One builder at a time (flock).
set -u
cd "$(dirname "$0")/../../.."
LEDGER=reference/tasks/vertical-slice-iteration07-20261026/generation/ledger.json
LOG=.cache/iteration07-p2-build.log
END=$(( $(date +%s) + ${1:-7000} ))
last=""
while [ "$(date +%s)" -lt "$END" ]; do
  m=$(stat -c %Y "$LEDGER" 2>/dev/null || echo 0)
  if [ "$m" != "$last" ]; then
    last="$m"
    { echo "=== $(date -u +%FT%TZ) ledger mtime $m"; flock /tmp/ll-p7-build.lock node tools/asset-pipeline/props/build-props-iteration07.mjs 2>&1 | grep -vE '^    (grid|raster|sampled|composed)'; } >> "$LOG"
  fi
  sleep 60
done
echo "=== $(date -u +%FT%TZ) watcher stopped" >> "$LOG"

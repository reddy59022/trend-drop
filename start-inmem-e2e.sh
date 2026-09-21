#!/bin/bash

# TrendDrop - In-memory E2E harness helper
# Boots server/e2eServer.js (in-memory MongoDB + seeded data) in the background
# so you can poke at the API with curl. Playwright starts this server itself
# via webServer in the e2e configs — use this script only for manual poking.
#
# Usage: ./start-inmem-e2e.sh
# Stop:  kill $(cat /tmp/trenddrop-e2e.pid)

set -e

# Resolve the repo root (directory containing this script) so the harness works
# from any working directory / checkout location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ ! -f "server/e2eServer.js" ]; then
  echo "Error: server/e2eServer.js not found. Run this script from the TrendDrop repo root." >&2
  exit 1
fi

PORT="${E2E_PORT:-5001}"
export E2E_IN_MEMORY=true

node server/e2eServer.js > /tmp/trenddrop-inmem-e2e.log 2>&1 &
E2E_PID=$!
echo "$E2E_PID" > /tmp/trenddrop-e2e.pid
echo "e2eServer PID: $E2E_PID (logs: /tmp/trenddrop-inmem-e2e.log)"

# Liveness only — /health is process-only and does not need MongoDB.
# Readiness (/readyz) additionally verifies the Mongo connection.
READY=0
for i in {1..30}; do
  if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
    READY=1
    echo "e2eServer ready on port ${PORT}"
    break
  fi
  echo "waiting... ($i)"
  sleep 2
done

if [ "$READY" != "1" ]; then
  echo "Error: e2eServer did not become healthy. Last log lines:" >&2
  tail -20 /tmp/trenddrop-inmem-e2e.log >&2
  exit 1
fi

curl -s "http://localhost:${PORT}/health" | python3 -m json.tool 2>/dev/null || true
curl -s "http://localhost:${PORT}/readyz" | python3 -m json.tool 2>/dev/null || true
echo "E2E_PID=$E2E_PID"

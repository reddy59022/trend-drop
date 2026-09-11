#!/bin/bash
set -e
export E2E_IN_MEMORY=true
cd /Users/nishithareddy/Documents/GitHub/trend-drop
node server/e2eServer.js &
E2E_PID=$!
echo "e2eServer PID: $E2E_PID"
sleep 12
for i in {1..20}; do
  if curl -sf http://localhost:5001/api/health/public > /dev/null 2>&1; then
    echo "e2eServer ready on port 5001"
    break
  fi
  echo "waiting... ($i)"
  sleep 2
done
curl -s http://localhost:5001/api/health/public | python3 -m json.tool 2>/dev/null || true
echo "E2E_PID=$E2E_PID"
echo "done: $!"

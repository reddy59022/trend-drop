#!/bin/bash
# Fetch GitHub Actions job log for a given run (uses stored git credential, never prints token)
set -e
RUN_ID="${1:?usage: fetch-job-log.sh RUN_ID}"
JOB=$(curl -s "https://api.github.com/repos/reddy59022/trend-drop/actions/runs/${RUN_ID}/jobs" | python3 -c "import json,sys; print(json.load(sys.stdin)['jobs'][0]['id'])")
echo "job=$JOB"
TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
if [ -z "$TOKEN" ]; then echo "NO TOKEN"; exit 1; fi
curl -sL -H "Authorization: Bearer $TOKEN" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/reddy59022/trend-drop/actions/jobs/${JOB}/logs" -o /tmp/ci-log.txt
echo "log saved: $(wc -l < /tmp/ci-log.txt) lines"

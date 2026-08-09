#!/bin/bash

# TrendDrop - Production Start Script
# Starts the Express server (serves the API + built client statically)
# with NODE_ENV=production. Safe to run from any working directory.

set -e

# Resolve the repo root (directory containing this script)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Ensure the server entrypoint exists
if [ ! -f "server/server.js" ]; then
  echo "Error: server/server.js not found. Run this script from the TrendDrop repo root." >&2
  exit 1
fi

echo "Starting TrendDrop server (NODE_ENV=production) on port ${PORT:-5000}..."
echo "Note: set real env values in the Render dashboard or a root .env file (dotenv loads from the working directory)."
exec env NODE_ENV=production node server/server.js

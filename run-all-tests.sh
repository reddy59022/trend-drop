#!/bin/bash
# Run all tests for TrendDrop project (portable — auto-detects repo root)
# Usage: ./run-all-tests.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "🧪 Running all tests for TrendDrop..."
echo ""

echo "🔹 Running server tests..."
cd "$REPO_ROOT/server"
npm run test:ci 2>&1 | tail -6
echo ""

echo "🔹 Building client (production)..."
cd "$REPO_ROOT/client"
npm run build 2>&1 | tail -3
echo ""

echo "🔹 Running Playwright E2E tests..."
cd "$REPO_ROOT"
npx playwright test 2>&1 | tail -6
echo ""

echo "✅ All tests completed."

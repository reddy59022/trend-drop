#!/bin/bash
# Run all tests for TrendDrop project
# Usage: ./run-all-tests.sh

echo "🧪 Running all tests for TrendDrop..."
echo ""

# Server tests
echo "🔹 Running server tests..."
cd /Users/owner/Desktop/trend-drop/server
npm test 2>&1 | tail -5
echo ""

# Client tests
echo "🔹 Running client tests..."
cd /Users/owner/Desktop/trend-drop/client
npm test 2>&1 | tail -5
echo ""

echo "✅ All tests completed. Check output above for details."

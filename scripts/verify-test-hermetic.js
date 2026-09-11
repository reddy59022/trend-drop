#!/usr/bin/env node
/**
 * verify-test-hermetic.js — security guard that fails CI if any test file
 * references a production MongoDB Atlas URI (mongodb+srv://) or other
 * non-hermetic external service. Runs in pre-test CI stage.
 *
 * Exit 0 = safe (no production URIs found).
 * Exit 1 = FAIL (production credentials detected in test paths).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCAN_DIRS = ['server/tests', 'e2e', 'client/src'];
const PROD_PATTERNS = [
  /mongodb\+srv:\/\//i,
  /mongodb:\/\/[^/]*@[^/]*mongodb\.net/i,
  /sk_live_/i,
  /pk_live_/i,
];
const ALLOWED = [
  /mongodb-memory-server/,
  /mongodb:\/\/localhost/,
  /mongodb:\/\/127\.0\.0\.1/,
];

let violations = [];

function scanFile(file) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (ALLOWED.some((re) => re.test(line))) return;
    PROD_PATTERNS.forEach((re) => {
      if (re.test(line)) {
        violations.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  });
}

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      walk(full);
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
      scanFile(full);
    }
  }
}

SCAN_DIRS.forEach(walk);

if (violations.length) {
  console.error('❌ TEST-HERMETIC CHECK FAILED');
  console.error('Production credentials/endpoints found in test-scanned paths:');
  violations.forEach((v) => console.error('  ' + v));
  console.error('\nTests MUST use in-memory/local resources only.');
  process.exit(1);
}

console.log('✅ test-hermetic: no production URIs in test-scanned paths');
process.exit(0);

/**
 * Production E2E helpers — REAL user flows against the PRODUCTION database.
 *
 * Base URL defaults to the live Render deployment (https://trend-drop.onrender.com)
 * and uses the seeded production test accounts (see SESSION_LOG.md):
 *   - reddy59021@gmail.com  (Alex Rivera  — "Alex Vintage Finds")
 *   - reddy59022@gmail.com  (Jordan Patel — "Jordan's Closet")
 *
 * These tests exercise the real Stripe TEST-mode integration, the real MongoDB
 * production database and the real deployed API — no mocks.
 *
 * Run:  npm run test:e2e:prod
 */
const { request, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_URL = process.env.E2E_PROD_BASE_URL || 'https://trend-drop.onrender.com';

/** Stable per-invocation run id — set by the npm script so all spec files share it. */
const RUN_ID = process.env.E2E_RUN_ID || `manual-${Date.now()}`;

/** Production seeded accounts (SESSION_LOG.md). */
const ACCOUNTS = {
  alex: { email: 'reddy59021@gmail.com', password: 'Password123!', name: 'Alex Rivera' },
  jordan: { email: 'reddy59022@gmail.com', password: 'Password123!', name: 'Jordan Patel' },
};

const STATE_FILE = path.join(os.tmpdir(), 'trenddrop-prod-e2e-state.json');

/**
 * JWT token cache — shared across ALL spec files and runs (JWTs last 30 days).
 * Avoids hammering /api/auth/login (rate-limited at 429 on production).
 */
const TOKEN_FILE = path.join(os.tmpdir(), 'trenddrop-prod-e2e-tokens.json');

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveTokens(tokens) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens)); } catch (_) { /* best effort */ }
}


/** Cross-spec-file state (Playwright loads each spec in its own worker process). */
function loadState() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw.runId === RUN_ID) return raw;
  } catch (_) { /* first write */ }
  return { runId: RUN_ID, listings: {}, orders: {}, txns: {}, users: {}, before: {} };
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Lightweight API "user" with JWT login + JSON helpers against the prod API.
 */
async function makeApi() {
  const ctx = await request.newContext({ baseURL: BASE_URL, timeout: 30_000 });
  const tokens = {};

  const api = {
    ctx,
    BASE_URL,
    RUN_ID,

    async req(method, url, { body, token, headers } = {}) {
      const h = { ...(headers || {}) };
      if (token) h.Authorization = `Bearer ${token}`;
      const res = await ctx.fetch(url, { method, data: body, headers: h, failOnStatusCode: false });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
      return { status: res.status(), data };
    },

    /** Login (cached across spec files AND runs) → JWT token. */
    async login(accountKey) {
      const cached = loadTokens();
      if (cached[accountKey]) {
        // Validate the cached token once; refresh silently if it expired.
        const check = await this.req('get', '/api/users/me', { token: cached[accountKey] });
        if (check.status === 200) { tokens[accountKey] = cached[accountKey]; return tokens[accountKey]; }
      }
      const account = ACCOUNTS[accountKey];
      // /api/auth/login is rate-limited (20 attempts / 15 min on prod).
      // Retry with backoff so a shared window with other automation doesn't flake the suite.
      let r;
      for (let attempt = 1; attempt <= 8; attempt++) {
        r = await this.req('post', '/api/auth/login', { body: { email: account.email, password: account.password } });
        if (r.status === 200) break;
        if (r.status === 429 && attempt < 8) {
          await new Promise((res) => setTimeout(res, 25_000));
          continue;
        }
        break;
      }
      expect(r.status, `login failed for ${account.email}: ${JSON.stringify(r.data)}`).toBe(200);
      expect(r.data?.token, 'login response must include a JWT token').toBeTruthy();
      tokens[accountKey] = r.data.token;
      cached[accountKey] = r.data.token;
      saveTokens(cached);
      return tokens[accountKey];
    },

    async me(accountKey) {
      const token = await this.login(accountKey);
      const r = await this.req('get', '/api/users/me', { token });
      expect(r.status).toBe(200);
      return r.data;
    },

    async dispose() { await ctx.dispose(); },
  };
  return api;
}

/** Numerically safe round to cents. */
const cents = (n) => Math.round(n * 100) / 100;

module.exports = { makeApi, loadState, saveState, ACCOUNTS, BASE_URL, RUN_ID, cents, expect };

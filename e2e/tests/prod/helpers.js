/**
 * E2E test helpers — shared utilities for user-flow simulation.
 *
 * Runs against TWO targets via BASE_URL (set by the Playwright config):
 *   • In-memory (default):  http://localhost:5001  — server/e2eServer.js
 *     spins up MongoMemoryServer + seeds users/listings/trends, boots the app.
 *   • Production smoke:     https://trend-drop.onrender.com  (npm run test:e2e:prod)
 *
 * Test accounts:
 *   • In-memory:  e2e-buyer@trenddrop.test / E2ePass123!  (buyer)
 *                 e2e-seller@trenddrop.test / E2ePass123!  (seller)
 *                 e2e-seller2@trenddrop.test / E2ePass123! (seller 2)
 *   • Production: reddy59021@gmail.com / Password123!  (Alex Rivera)
 *                 reddy59022@gmail.com / Password123!  (Jordan Patel)
 *
 * The same 22 spec files run against EITHER target without modification.
 */
const { request, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5001';
const IS_PROD = BASE_URL.includes('onrender.com') || BASE_URL.includes('https://');

const RUN_ID = process.env.E2E_RUN_ID || `e2e-${Date.now()}`;

/** Test accounts for the active target. */
const ACCOUNTS = IS_PROD
  ? {
      alex:   { email: 'reddy59021@gmail.com', password: 'Password123!', name: 'Alex Rivera' },
      jordan: { email: 'reddy59022@gmail.com', password: 'Password123!', name: 'Jordan Patel' },
    }
  : {
      // In-memory: 'alex' = seller, 'jordan' = buyer (matches all 22 spec files).
      // 'seller2' available for multi-seller scenarios needing a third account.
      alex:    { email: 'e2e-seller@trenddrop.test',  password: 'E2ePass123!', name: 'E2E Seller' },
      jordan:  { email: 'e2e-buyer@trenddrop.test',   password: 'E2ePass123!', name: 'E2E Buyer' },
      seller2: { email: 'e2e-seller2@trenddrop.test', password: 'E2ePass123!', name: 'E2E Seller Two' },
    };

const STATE_FILE = path.join(os.tmpdir(), `trenddrop-e2e-state-${IS_PROD ? 'prod' : 'memory'}-${RUN_ID}.json`);
const TOKEN_FILE = path.join(os.tmpdir(), `trenddrop-e2e-tokens-${IS_PROD ? 'prod' : 'memory'}-${RUN_ID}.json`);

function loadTokens() {
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveTokens(tokens) {
  try { fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens)); } catch (_) { /* best effort */ }
}

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

/** Returns true when running against the in-memory server (not production). */
const isMemory = () => !IS_PROD;

/**
 * Lightweight API "user" with JWT login + JSON helpers.
 * Caches tokens across spec files AND runs (JWTs last 30 days).
 */
async function makeApi() {
  const ctx = await request.newContext({ baseURL: BASE_URL, timeout: 30_000 });
  const tokens = {};

  const api = {
    ctx,
    BASE_URL,
    RUN_ID,
    IS_PROD,
    isMemory: () => isMemory(),

    async req(method, url, { body, token, headers } = {}) {
      const h = { ...(headers || {}) };
      if (token) h.Authorization = `Bearer ${token}`;
      const res = await ctx.fetch(url, { method, data: body, headers: h, failOnStatusCode: false });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { data = text; }
      return { status: res.status(), data };
    },

    async login(accountKey) {
      const cached = loadTokens();
      if (cached[accountKey]) {
        const check = await this.req('get', '/api/users/me', { token: cached[accountKey] });
        if (check.status === 200) { tokens[accountKey] = cached[accountKey]; return tokens[accountKey]; }
      }
      const account = ACCOUNTS[accountKey];
      let r;
      for (let attempt = 1; attempt <= 8; attempt++) {
        r = await this.req('post', '/api/auth/login', { body: { email: account.email, password: account.password } });
        if (r.status === 200) break;
        if (r.status === 429 && attempt < 8) {
          await new Promise((res) => setTimeout(res, 5_000));
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

    /** In-memory only: reset state by re-seeding via server restart is handled by webServer.
     *  For prod, clear ephemeral test data created this run. */
    async cleanupRunData(token) {
      if (this.IS_PROD) {
        const state = loadState();
        // Delete listings created this run
        for (const key of Object.keys(state.listings || {})) {
          const id = state.listings[key]?.id;
          if (id) await this.req('delete', `/api/listings/${id}`, { token }).catch(() => {});
        }
      }
    },

    async dispose() { await ctx.dispose(); },
  };
  return api;
}

/** Numerically safe round to cents. */
const cents = (n) => Math.round(n * 100) / 100;

/**
 * In-memory server boost fee (server/config/boost.js DEFAULT_BOOST_FEE_PERCENT = 5).
 * Production may differ; tests use the server-side response rather than hardcoding.
 */
const BOOST_FEE_PERCENT = 5;

module.exports = {
  makeApi, loadState, saveState, ACCOUNTS, BASE_URL, RUN_ID, cents, expect,
  isMemory, BOOST_FEE_PERCENT, IS_PROD,
};

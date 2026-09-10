/**
 * PROD E2E — 06: seller payouts (real production balances, real guard rails).
 * Includes the regression checks from SESSION_LOG.md (NaN/null balances, ÷100 bug).
 */
const { test } = require('@playwright/test');
const { makeApi, loadState, saveState, expect } = require('./helpers');

function assertNumericBalances(d, label) {
  for (const key of ['totalEarnings', 'totalEarned', 'availableBalance', 'pendingBalance']) {
    const v = d[key];
    expect(typeof v === 'number' && Number.isFinite(v), `${label}.${key} must be a finite number, got ${v}`).toBe(true);
  }
}

test.describe('06 · Payouts (production)', () => {
  let api, state, alexToken, jordanToken;

  test.beforeAll(async () => {
    api = await makeApi();
    state = loadState();
    alexToken = await api.login('alex');
    jordanToken = await api.login('jordan');
  });
  test.afterAll(async () => { await api.dispose(); });

  test('seller payout dashboard returns sane numeric balances (Alex)', async () => {
    const r = await api.req('get', '/api/payouts/dashboard', { token: alexToken });
    expect(r.status, JSON.stringify(r.data)).toBe(200);
    assertNumericBalances(r.data, 'alex.dashboard');
    // Regression: legacy payout docs previously produced null/NaN → serialized null
    expect(r.data.availableBalance).not.toBeNull();
    // This run's batch earnings must be pending (when the batch checkout ran)
    if (state.txns?.batch?.A) {
      expect(r.data.pendingBalance).toBeGreaterThanOrEqual(41.4 + 61.6 - 0.01);
    }
  });

  test('buyer-seller Jordan dashboard is also numeric', async () => {
    const r = await api.req('get', '/api/payouts/dashboard', { token: jordanToken });
    expect(r.status).toBe(200);
    assertNumericBalances(r.data, 'jordan.dashboard');
  });

  test('balance endpoint returns numeric balances consistent with the dashboard', async () => {
    const bal = await api.req('get', '/api/payouts/balance', { token: alexToken });
    expect(bal.status).toBe(200);
    const dash = await api.req('get', '/api/payouts/dashboard', { token: alexToken });
    const b = bal.data?.availableBalance ?? bal.data?.balance?.available ?? bal.data?.balance;
    expect(typeof b === 'number' && Number.isFinite(b), `balance must be numeric, got ${JSON.stringify(bal.data)}`).toBe(true);
    // ÷100 regression guard: balance endpoint must agree with the dashboard
    // (allow reasonable drift from concurrent activity, never 100× or 1000×).
    expect(b, `payouts/balance (${b}) vs dashboard (${dash.data.availableBalance}) must agree`).toBeCloseTo(dash.data.availableBalance, 1);
  });

  test('commission info exposes the platform commission', async () => {
    const r = await api.req('get', '/api/payouts/commission-info', { token: alexToken });
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.data)).toMatch(/8/); // 8% commission
  });

  test('payouts require auth', async () => {
    const r = await api.req('get', '/api/payouts/dashboard');
    expect([401, 403]).toContain(r.status);
  });

  test('cashout without a configured payout method or balance is guarded (400)', async () => {
    const r = await api.req('post', '/api/payments/payout', { token: jordanToken, body: { amount: 10 } });
    expect(r.status).toBe(400);
    // Either guard is correct: no payout method configured, or no spendable balance.
    expect(r.data.message).toMatch(/payout method|available balance/i);
  });

  test('cashout rejects invalid amounts', async () => {
    const r = await api.req('post', '/api/payments/payout', { token: alexToken, body: { amount: -5 } });
    expect([400]).toContain(r.status);
  });

  test('payout dashboard surfaces this run’s pending earnings for Alex', async () => {
    const r = await api.req('get', '/api/payouts/dashboard', { token: alexToken });
    expect(r.status).toBe(200);
    const txns = r.data.recentTransactions || r.data.transactions || [];
    // recentTransactions are PAYOUT docs; match by embedded transaction id too.
    const ids = new Set();
    for (const t of txns) {
      ids.add(String(t._id));
      if (t.transaction?._id) ids.add(String(t.transaction._id));
      if (typeof t.transaction === 'string') ids.add(String(t.transaction));
    }
    expect(ids.has(String(state.txns.batch.A.id)), `batch A txn missing from payout docs: ${[...ids]}`).toBe(true);
    expect(ids.has(String(state.txns.batch.B.id)), `batch B txn missing from payout docs: ${[...ids]}`).toBe(true);
    saveState(state);
  });
});

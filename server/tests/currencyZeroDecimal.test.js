/**
 * TDD Round 26 — Zero-decimal currency conversion parity.
 *
 * BUG: server `convertPrice` (config/currencies.js) always rounds to 2
 * decimals, ignoring the currency's `decimals` field. Zero-decimal
 * currencies (JPY 149.5, KRW 1328, IDR 15680, HUF 356, ...) therefore
 * produce fractional sub-unit amounts (convertPrice(1.29, 'JPY') ===
 * 192.86) that cannot exist in those currencies — the client's shared
 * engine (client/src/utils/helpers.js convertAmount) honors `decimals`
 * and yields 193. Server/client must agree: money amounts are always
 * integral units in zero-decimal currencies.
 */
const { currencies, convertPrice } = require('../config/currencies');

describe('TDD R26 — convertPrice honors per-currency decimals', () => {
  test('zero-decimal currency (JPY) never yields fractional units', () => {
    // 1.29 USD * 149.5 = 192.855 -> must round to 193 (not 192.86)
    expect(convertPrice(1.29, 'JPY')).toBe(193);
    // sub-unit USD amounts must not leak fractional yen either
    expect(convertPrice(0.05, 'JPY')).toBe(7); // 7.475
    expect(convertPrice(100, 'JPY')).toBe(14950); // exact, unchanged
  });

  test('zero-decimal currency (KRW) rounds to whole won', () => {
    expect(convertPrice(100, 'KRW')).toBe(132800);
    expect(convertPrice(1.001, 'KRW')).toBe(1329); // 1329.328
  });

  test('zero-decimal currency (IDR) rounds to whole rupiah', () => {
    expect(convertPrice(10.555, 'IDR')).toBe(165502); // 165502.4
  });

  test('zero-decimal currency (HUF) rounds to whole forint', () => {
    expect(convertPrice(3.33, 'HUF')).toBe(1185); // 1185.48
  });

  test('three-decimal currency (KWD) keeps its fraction digits', () => {
    // 12.345 * 0.31 = 3.82695 -> 3.827 (3 decimals)
    expect(convertPrice(12.345, 'KWD')).toBe(3.827);
  });

  test('two-decimal currencies keep cent rounding', () => {
    expect(convertPrice(19.99, 'EUR')).toBe(18.39); // 18.3908
    expect(convertPrice(19.99, 'USD')).toBe(19.99);
    expect(convertPrice(100, 'CAD')).toBeCloseTo(136, 2);
  });

  test('unknown currency passes the amount through unchanged', () => {
    expect(convertPrice(5, 'NOPE')).toBe(5);
  });

  test('engine agrees with the currency table decimals for every currency', () => {
    const { getAllCurrencyCodes } = require('../config/currencies');
    for (const code of getAllCurrencyCodes()) {
      const decimals = currencies[code].decimals != null ? currencies[code].decimals : 2;
      const out = convertPrice(1.29, code);
      const rounded = Math.round(out * Math.pow(10, decimals)) / Math.pow(10, decimals);
      // The output must already sit exactly on the currency's own grid.
      expect(Math.abs(out - rounded)).toBeLessThan(1e-9);
    }
  });
});

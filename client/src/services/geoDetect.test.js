/**
 * Unit tests for the geo auto-selection service that powers the top-right
 * country + currency selectors on web, iOS and Android.
 *
 * The service must:
 *  - extract + validate { country, currency } from /marketplace/status
 *  - normalize garbage safely (lowercase, whitespace, invalid codes)
 *  - fall back to the client country→currency map when the server omits
 *    currency (older backend) and to USD when everything is unknown
 *  - respect explicit user choices over IP auto-detection
 *  - re-detect on every load only while values are auto-sourced
 *  - dedupe concurrent detections (React 18 StrictMode double-effect)
 */
import {
  DEFAULT_CURRENCY,
  AUTO_SOURCE,
  MANUAL_SOURCE,
  normalizeCountry,
  normalizeCurrency,
  extractGeo,
  decideAutoDetect,
  applyDetectedGeo,
  detectGeo,
} from './geoDetect';

jest.mock('./api', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

import api from './api';

describe('normalizeCountry', () => {
  test('normalizes to uppercase 2-letter codes', () => {
    expect(normalizeCountry(' gb ')).toBe('GB');
    expect(normalizeCountry('de')).toBe('DE');
  });

  test('rejects invalid country values', () => {
    expect(normalizeCountry(null)).toBeNull();
    expect(normalizeCountry(undefined)).toBeNull();
    expect(normalizeCountry('')).toBeNull();
    expect(normalizeCountry('G')).toBeNull();       // too short
    expect(normalizeCountry('GBR')).toBeNull();     // 3-letter not accepted
    expect(normalizeCountry('12')).toBeNull();      // digits
    expect(normalizeCountry(42)).toBeNull();        // numbers
    expect(normalizeCountry({})).toBeNull();        // objects
    expect(normalizeCountry(['GB'])).toBeNull();    // arrays
  });
});

describe('normalizeCurrency', () => {
  test('accepts currencies the app can format', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency(' GBP ')).toBe('GBP');
    expect(normalizeCurrency('SEK')).toBe('SEK');
  });

  test('rejects currencies the app cannot format or malformed codes', () => {
    expect(normalizeCurrency('us')).toBeNull();     // 2 letters
    expect(normalizeCurrency('EURO')).toBeNull();   // 4 letters
    expect(normalizeCurrency('123')).toBeNull();
    expect(normalizeCurrency('ZZZ')).toBeNull();    // not a real currency
    expect(normalizeCurrency(null)).toBeNull();
    expect(normalizeCurrency({})).toBeNull();
  });
});

describe('extractGeo — from /marketplace/status payload', () => {
  test('passes through a valid server response', () => {
    expect(extractGeo({ country: 'GB', currency: 'GBP' })).toEqual({ country: 'GB', currency: 'GBP' });
  });

  test('normalizes lowercase values from the server', () => {
    expect(extractGeo({ country: 'de', currency: 'eur' })).toEqual({ country: 'DE', currency: 'EUR' });
  });

  test('derives currency from the country when the server omits it (older backend)', () => {
    expect(extractGeo({ country: 'GB' })).toEqual({ country: 'GB', currency: 'GBP' });
    expect(extractGeo({ country: 'DE', supported: true })).toEqual({ country: 'DE', currency: 'EUR' });
  });

  test('falls back to USD when currency is invalid but country is known', () => {
    expect(extractGeo({ country: 'XX', currency: 'EURO' })).toEqual({ country: 'XX', currency: 'USD' });
  });

  test('unknown-but-shape-valid country still yields a valid currency fallback', () => {
    expect(extractGeo({ country: 'XK' })).toEqual({ country: 'XK', currency: 'USD' });
  });

  test('trusts the server currency even if it differs from the country map (server is source of truth)', () => {
    expect(extractGeo({ country: 'US', currency: 'EUR' })).toEqual({ country: 'US', currency: 'EUR' });
  });

  test('keeps a valid currency even when the country is invalid', () => {
    expect(extractGeo({ country: '123', currency: 'GBP' })).toEqual({ country: null, currency: 'GBP' });
  });

  test('handles missing/garbage payloads without throwing', () => {
    const fallback = { country: null, currency: DEFAULT_CURRENCY };
    expect(extractGeo(null)).toEqual(fallback);
    expect(extractGeo(undefined)).toEqual(fallback);
    expect(extractGeo('nope')).toEqual(fallback);
    expect(extractGeo(42)).toEqual(fallback);
    expect(extractGeo(['GB', 'GBP'])).toEqual(fallback);
    expect(extractGeo({})).toEqual(fallback);
  });
});


describe('decideAutoDetect — manual choice beats IP detection', () => {
  test('fresh visitor: detect both from IP', () => {
    expect(decideAutoDetect({})).toEqual({
      detectCountry: true,
      detectCurrency: true,
      apiNeeded: true,
      localCurrency: null,
    });
  });

  test('manual currency + manual country: nothing to do, no API call', () => {
    expect(decideAutoDetect({
      currency: 'USD', currencySource: MANUAL_SOURCE,
      country: 'US', countrySource: MANUAL_SOURCE,
    })).toEqual(expect.objectContaining({ apiNeeded: false, detectCountry: false, detectCurrency: false }));
  });

  test('manual currency only: country is still detected from IP, currency preserved', () => {
    const decision = decideAutoDetect({ currency: 'USD', currencySource: MANUAL_SOURCE });
    expect(decision.detectCountry).toBe(true);
    expect(decision.detectCurrency).toBe(false);
    expect(decision.apiNeeded).toBe(true);
  });

  test('manual country only: currency derives locally from the chosen country (no API)', () => {
    const decision = decideAutoDetect({ country: 'FR', countrySource: MANUAL_SOURCE });
    expect(decision.detectCountry).toBe(false);
    expect(decision.detectCurrency).toBe(true);
    expect(decision.apiNeeded).toBe(false);
    expect(decision.localCurrency).toBe('EUR');
  });

  test('legacy saved currency without a marker is treated as manual (never clobbered)', () => {
    const decision = decideAutoDetect({ currency: 'USD', country: null });
    expect(decision.detectCurrency).toBe(false);
    expect(decision.detectCountry).toBe(true);
    expect(decision.apiNeeded).toBe(true);
  });

  test('auto-sourced values re-detect on every load (IP changes self-heal)', () => {
    const decision = decideAutoDetect({
      currency: 'GBP', currencySource: AUTO_SOURCE,
      country: 'GB', countrySource: AUTO_SOURCE,
    });
    expect(decision.detectCountry).toBe(true);
    expect(decision.detectCurrency).toBe(true);
    expect(decision.apiNeeded).toBe(true);
  });
});

describe('applyDetectedGeo — merges detection into current state', () => {
  const detectAll = decideAutoDetect({});

  test('applies country + currency for a fresh visitor', () => {
    expect(applyDetectedGeo({ country: null, currency: 'USD' }, { country: 'GB', currency: 'GBP' }, detectAll))
      .toEqual({ country: 'GB', currency: 'GBP' });
  });

  test('never overwrites a manual currency', () => {
    const decision = decideAutoDetect({ currency: 'USD', currencySource: MANUAL_SOURCE });
    expect(applyDetectedGeo({ country: null, currency: 'USD' }, { country: 'GB', currency: 'GBP' }, decision))
      .toEqual({ country: 'GB', currency: 'USD' });
  });

  test('never overwrites a manual country', () => {
    const decision = decideAutoDetect({ country: 'FR', countrySource: MANUAL_SOURCE });
    expect(applyDetectedGeo({ country: 'FR', currency: 'USD' }, { country: 'DE', currency: 'EUR' }, decision))
      .toEqual({ country: 'FR', currency: 'EUR' });
  });

  test('no-op on a failed detection', () => {
    expect(applyDetectedGeo({ country: 'GB', currency: 'GBP' }, null, detectAll))
      .toEqual({ country: 'GB', currency: 'GBP' });
  });

  test('currency applies even when detection carries no country', () => {
    expect(applyDetectedGeo({ country: null, currency: 'USD' }, { country: null, currency: 'EUR' }, detectAll))
      .toEqual({ country: null, currency: 'EUR' });
  });
});

describe('detectGeo — API orchestration', () => {
  beforeEach(() => {
    api.get.mockReset();
  });

  test('calls /marketplace/status WITHOUT a hint so the server resolves the IP', async () => {
    api.get.mockResolvedValueOnce({ data: { country: 'GB', currency: 'GBP', supported: true } });
    const geo = await detectGeo(api);
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith('/marketplace/status');
    expect(geo).toEqual({ country: 'GB', currency: 'GBP' });
  });

  test('returns null on network failure (caller keeps its defaults)', async () => {
    api.get.mockRejectedValueOnce(new Error('network down'));
    expect(await detectGeo(api)).toBeNull();
  });

  test('returns null on a 5xx-style rejected request', async () => {
    api.get.mockRejectedValueOnce({ response: { status: 500 } });
    expect(await detectGeo(api)).toBeNull();
  });

  test('dedupes concurrent calls so React StrictMode double-effects fire ONE request', async () => {
    let resolveStatus;
    api.get.mockImplementationOnce(() => new Promise((resolve) => { resolveStatus = resolve; }));

    const first = detectGeo(api);
    const second = detectGeo(api); // synchronous double-effect
    expect(api.get).toHaveBeenCalledTimes(1);

    resolveStatus({ data: { country: 'DE', currency: 'EUR' } });
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual({ country: 'DE', currency: 'EUR' });
    expect(b).toEqual({ country: 'DE', currency: 'EUR' });
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  test('a NEW detection after the previous resolved issues a fresh request (per-load refresh)', async () => {
    api.get.mockResolvedValueOnce({ data: { country: 'GB', currency: 'GBP' } });
    await detectGeo(api);

    api.get.mockResolvedValueOnce({ data: { country: 'CH', currency: 'CHF' } });
    const geo = await detectGeo(api);
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(geo).toEqual({ country: 'CH', currency: 'CHF' });
  });
});

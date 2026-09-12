/**
 * Currency data integrity for the IP-based top-right auto-selection.
 *
 * helpers.js mirrors server/config/currencies.js: every currency the server
 * can resolve from a visitor's IP must be formattable client-side, and
 * getCurrencyByCountry must cover the launch markets (USA + Europe) with
 * correct ISO 4217 codes.
 */
import { getCurrencyByCountry, currencies, formatPrice, SUPPORTED_CURRENCY_CODES } from './helpers';

describe('getCurrencyByCountry — country → currency map (launch markets)', () => {
  test('maps each launch-market country to its ISO 4217 currency', () => {
    expect(getCurrencyByCountry('US')).toBe('USD');
    expect(getCurrencyByCountry('GB')).toBe('GBP');
    expect(getCurrencyByCountry('DE')).toBe('EUR');
    expect(getCurrencyByCountry('FR')).toBe('EUR');
    expect(getCurrencyByCountry('IT')).toBe('EUR');
    expect(getCurrencyByCountry('ES')).toBe('EUR');
    expect(getCurrencyByCountry('NL')).toBe('EUR');
    expect(getCurrencyByCountry('CH')).toBe('CHF');
    expect(getCurrencyByCountry('SE')).toBe('SEK');
    expect(getCurrencyByCountry('NO')).toBe('NOK');
    expect(getCurrencyByCountry('DK')).toBe('DKK');
    expect(getCurrencyByCountry('PL')).toBe('PLN');
    expect(getCurrencyByCountry('CZ')).toBe('CZK');
    expect(getCurrencyByCountry('HU')).toBe('HUF');
    expect(getCurrencyByCountry('RO')).toBe('RON');
    expect(getCurrencyByCountry('BG')).toBe('BGN');
    expect(getCurrencyByCountry('IS')).toBe('ISK');
    expect(getCurrencyByCountry('TR')).toBe('TRY');
    expect(getCurrencyByCountry('CA')).toBe('CAD');
    expect(getCurrencyByCountry('AU')).toBe('AUD');
    expect(getCurrencyByCountry('JP')).toBe('JPY');
    expect(getCurrencyByCountry('IN')).toBe('INR');
    expect(getCurrencyByCountry('BR')).toBe('BRL');
    expect(getCurrencyByCountry('AE')).toBe('AED');
  });

  test('Nigeria maps to NGN (regression: previously returned the invalid "NG")', () => {
    expect(getCurrencyByCountry('NG')).toBe('NGN');
  });

  test('normalizes lowercase input', () => {
    expect(getCurrencyByCountry('gb')).toBe('GBP');
    expect(getCurrencyByCountry(' se ')).toBe('SEK');
  });

  test('unknown/absent countries fall back to USD', () => {
    expect(getCurrencyByCountry('XK')).toBe('USD');
    expect(getCurrencyByCountry(null)).toBe('USD');
    expect(getCurrencyByCountry(undefined)).toBe('USD');
    expect(getCurrencyByCountry('')).toBe('USD');
  });
});

describe('currencies map — mirrors server config for every IP-resolvable currency', () => {
  test('all European launch currencies exist with symbol, name and rate', () => {
    for (const code of ['CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'RSD', 'UAH', 'ISK']) {
      expect(currencies[code]).toBeTruthy();
      expect(typeof currencies[code].symbol).toBe('string');
      expect(typeof currencies[code].rate).toBe('number');
      expect(currencies[code].rate).toBeGreaterThan(0);
    }
  });

  test('every exported supported currency code is a valid formattable key', () => {
    expect(SUPPORTED_CURRENCY_CODES).toEqual(expect.arrayContaining(['USD', 'EUR', 'GBP', 'SEK', 'CHF']));
    for (const code of SUPPORTED_CURRENCY_CODES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
      expect(currencies[code]).toBeTruthy();
    }
  });

  test('formatPrice formats every supported currency without throwing', () => {
    for (const code of SUPPORTED_CURRENCY_CODES) {
      const formatted = formatPrice(100, code);
      expect(formatted).toContain('100');
      expect(typeof formatted).toBe('string');
    }
  });
});

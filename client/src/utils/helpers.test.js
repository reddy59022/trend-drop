/**
 * Currency data integrity for the IP-based top-right auto-selection.
 *
 * helpers.js mirrors server/config/currencies.js: every currency the server
 * can resolve from a visitor's IP must be formattable client-side, and
 * getCurrencyByCountry must cover the launch markets (USA + Europe) with
 * correct ISO 4217 codes.
 *
 * Also covers the GLOBAL CURRENCY STANDARD: formatPrice(amount, source)
 * converts the amount from the record's currency into the user's preferred
 * currency (kept in the preferred-currency store by ThemeContext).
 */
import {
  getCurrencyByCountry,
  currencies,
  formatPrice,
  formatPriceRaw,
  convertAmount,
  convertPrice,
  convertToUSD,
  convertFromUSDTo,
  convertBetweenCurrencies,
  getPreferredCurrency,
  setPreferredCurrency,
  subscribePreferredCurrency,
  SUPPORTED_CURRENCY_CODES,
} from './helpers';

beforeEach(() => {
  // The preferred-currency store is module state — reset to USD for a
  // deterministic baseline in every test.
  setPreferredCurrency('USD');
});

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
      // Preferred = USD: amounts denominated in `code` convert to USD.
      const formatted = formatPrice(100, code);
      expect(typeof formatted).toBe('string');
      expect(formatted.length).toBeGreaterThan(0);
      // Never NaN anywhere in the output.
      expect(formatted).not.toMatch(/NaN/);
    }
  });
});

describe('GLOBAL CURRENCY STANDARD — formatPrice(amount, sourceCurrency)', () => {
  test('with preferred USD: USD amounts display unchanged', () => {
    expect(formatPrice(89.99, 'USD')).toBe('$89.99');
    expect(formatPrice(89.99)).toBe('$89.99'); // 1-arg defaults to USD source
  });

  test('converts the record currency into the preferred currency (EUR listing, USD viewer)', () => {
    // 100 EUR × (1 / 0.92) = 108.70 USD
    expect(formatPrice(100, 'EUR')).toBe('$108.70');
  });

  test('converts into the selected preferred currency (USD record, EUR viewer)', () => {
    setPreferredCurrency('EUR');
    // 89.99 USD × 0.92 = 82.79 EUR
    expect(formatPrice(89.99, 'USD')).toBe('€82.79');
  });

  test('round-trips through the USD base between two non-USD currencies', () => {
    setPreferredCurrency('GBP');
    // 92 EUR → USD 100 → GBP 79.00 (0.79 per USD)
    expect(formatPrice(92, 'EUR')).toBe('£79.00');
  });

  test('uses the preferred currency decimals (JPY has none)', () => {
    setPreferredCurrency('JPY');
    // 10 USD × 149.5 = 1495 JPY, 0 decimals
    expect(formatPrice(10, 'USD')).toBe('¥1,495');
  });

  test('legacy 3-argument calls (amount, target, from) convert from the 3rd argument', () => {
    // ListingCard-style legacy call: amount is in listingCurrency (EUR),
    // viewer currency (USD) was the 2nd arg — conversion must use EUR → USD.
    expect(formatPrice(100, 'USD', 'EUR')).toBe('$108.70');
  });

  test('null/undefined amounts render a zero value in the preferred currency', () => {
    expect(formatPrice(null, 'EUR')).toBe('$0.00');
    setPreferredCurrency('JPY');
    // JPY has zero decimals → "¥0", not "¥0.00"
    expect(formatPrice(null, 'USD')).toBe('¥0');
  });

  test('unknown source currencies are treated as USD (never NaN, never throws)', () => {
    expect(formatPrice(50, 'XYZ')).toBe('$50.00');
    expect(formatPrice(50, undefined)).toBe('$50.00');
    expect(formatPrice(50, '')).toBe('$50.00');
  });

  test('negative amounts keep their sign', () => {
    expect(formatPrice(-10, 'USD')).toBe('-$10.00');
  });
});

describe('formatPriceRaw — non-converting format for money-input guidance', () => {
  test('formats in the exact currency given, regardless of preferred currency', () => {
    setPreferredCurrency('EUR');
    expect(formatPriceRaw(100, 'USD')).toBe('$100.00');
    expect(formatPriceRaw(100, 'EUR')).toBe('€100.00');
    expect(formatPriceRaw(50)).toBe('$50.00'); // the $50 offer floor in offer currency
  });
});

describe('convertAmount / legacy convert helpers — one shared engine', () => {
  test('USD → X multiplies by the per-USD rate', () => {
    expect(convertAmount(100, 'USD', 'EUR')).toBe(92);
    expect(convertPrice(100, 'EUR')).toBe(92);
    expect(convertFromUSDTo(100, 'EUR')).toBe(92); // regression: previously DIVIDED (wrong direction)
  });

  test('X → USD divides by the per-USD rate', () => {
    expect(convertAmount(92, 'EUR', 'USD')).toBe(100);
    expect(convertToUSD(92, 'EUR')).toBe(100); // regression: previously MULTIPLIED (wrong direction)
  });

  test('X → Y routes through USD', () => {
    expect(convertAmount(92, 'EUR', 'GBP')).toBe(79);
    expect(convertBetweenCurrencies(92, 'EUR', 'GBP')).toBe(79);
    expect(convertBetweenCurrencies(100, 'USD', 'USD')).toBe(100);
  });

  test('rounds to the target currency decimals', () => {
    expect(convertAmount(1, 'USD', 'USD')).toBe(1);
    expect(convertAmount(10, 'USD', 'JPY')).toBe(1495); // 0 decimals
    expect(convertAmount(1, 'USD', 'KWD')).toBeCloseTo(0.31, 2); // 3 decimals
  });
});

describe('preferred-currency store', () => {
  test('set/get round-trip and invalid codes fall back to USD', () => {
    expect(getPreferredCurrency()).toBe('USD');
    setPreferredCurrency('eur'); // lowercase input is normalized
    expect(getPreferredCurrency()).toBe('EUR');
    setPreferredCurrency('NOPE');
    expect(getPreferredCurrency()).toBe('USD');
  });

  test('notifies subscribers on change, not on no-op sets', () => {
    const listener = jest.fn();
    const unsubscribe = subscribePreferredCurrency(listener);
    setPreferredCurrency('GBP');
    expect(listener).toHaveBeenCalledTimes(1);
    setPreferredCurrency('GBP'); // no-op
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setPreferredCurrency('USD');
    expect(listener).toHaveBeenCalledTimes(1); // unsubscribed → no more calls
  });

  test('a throwing listener never breaks other subscribers', () => {
    const bad = jest.fn(() => { throw new Error('boom'); });
    const good = jest.fn();
    const unsubBad = subscribePreferredCurrency(bad);
    const unsubGood = subscribePreferredCurrency(good);
    expect(() => setPreferredCurrency('CHF')).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    unsubBad();
    unsubGood();
    setPreferredCurrency('USD');
  });
});

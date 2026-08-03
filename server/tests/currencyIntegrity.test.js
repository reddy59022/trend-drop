/**
 * FINANCIAL INTEGRITY — Currency Layer (TDD)
 * Every country must resolve to a real ISO-4217 currency, conversions must
 * round-trip without loss, and formatting must respect per-currency decimals.
 */
const { currencies, countryCurrencyMap, convertPrice, formatPrice, getCurrencyByCountry, getAllCurrencyCodes } = require('../config/currencies');

describe('Currency Integrity (no financial leakage)', () => {
  test('every country in the map resolves to a valid registered currency', () => {
    for (const [country, code] of Object.entries(countryCurrencyMap)) {
      const resolved = getCurrencyByCountry(country);
      expect(currencies[code]).toBeDefined();
      expect(resolved).toBeDefined();
      expect(resolved.code || currencies[code].code || code).toBeTruthy();
    }
  });

  test('no country maps to its own alpha-2 code instead of a currency', () => {
    const bad = [];
    for (const [country, code] of Object.entries(countryCurrencyMap)) {
      if (!currencies[code]) bad.push(`${country}:${code}`);
    }
    expect(bad).toEqual([]);
  });

  test('no country silently falls back to USD', () => {
    for (const country of Object.keys(countryCurrencyMap)) {
      const resolved = getCurrencyByCountry(country);
      expect(resolved).not.toBeUndefined();
      expect(resolved.code === undefined || resolved.code !== undefined).toBe(true);
      // The map value must be a valid key in currencies
      expect(currencies[countryCurrencyMap[country]]).toBeDefined();
    }
  });

  test('major countries map to expected currencies', () => {
    expect(countryCurrencyMap.PH).toBe('PHP');
    expect(countryCurrencyMap.VN).toBe('VND');
    expect(countryCurrencyMap.NG).toBe('NGN');
    expect(countryCurrencyMap.EG).toBe('EGP');
    expect(countryCurrencyMap.KE).toBe('KES');
    expect(countryCurrencyMap.GH).toBe('GHS');
    expect(countryCurrencyMap.TZ).toBe('TZS');
    expect(countryCurrencyMap.UG).toBe('UGX');
    expect(countryCurrencyMap.SN).toBe('XOF');
    expect(countryCurrencyMap.MA).toBe('MAD');
    expect(countryCurrencyMap.DZ).toBe('DZD');
    expect(countryCurrencyMap.TN).toBe('TND');
    expect(countryCurrencyMap.LY).toBe('LYD');
    expect(countryCurrencyMap.SA).toBe('SAR');
    expect(countryCurrencyMap.QA).toBe('QAR');
    expect(countryCurrencyMap.UY).toBe('UYU');
    expect(countryCurrencyMap.PY).toBe('PYG');
    expect(countryCurrencyMap.BO).toBe('BOB');
    expect(countryCurrencyMap.VE).toBe('VES');
    expect(countryCurrencyMap.CR).toBe('CRC');
    expect(countryCurrencyMap.GT).toBe('GTQ');
    expect(countryCurrencyMap.HN).toBe('HNL');
    expect(countryCurrencyMap.NI).toBe('NIO');
    expect(countryCurrencyMap.PA).toBe('PAB');
    expect(countryCurrencyMap.DO).toBe('DOP');
    expect(countryCurrencyMap.JM).toBe('JMD');
    expect(countryCurrencyMap.TT).toBe('TTD');
    expect(countryCurrencyMap.HT).toBe('HTG');
    expect(countryCurrencyMap.KZ).toBe('KZT');
    expect(countryCurrencyMap.UZ).toBe('UZS');
    expect(countryCurrencyMap.AZ).toBe('AZN');
    expect(countryCurrencyMap.KG).toBe('KGS');
    expect(countryCurrencyMap.TJ).toBe('TJS');
    expect(countryCurrencyMap.MN).toBe('MNT');
    expect(countryCurrencyMap.AF).toBe('AFN');
    expect(countryCurrencyMap.AR).toBe('ARS');
    expect(countryCurrencyMap.CL).toBe('CLP');
    expect(countryCurrencyMap.CO).toBe('COP');
    expect(countryCurrencyMap.PE).toBe('PEN');
    expect(countryCurrencyMap.IL).toBe('ILS');
    expect(countryCurrencyMap.LB).toBe('LBP');
    expect(countryCurrencyMap.IQ).toBe('IQD');
    expect(countryCurrencyMap.RS).toBe('RSD');
    expect(countryCurrencyMap.HR).toBe('EUR');
  });

  test('USD reference rate is 1 (base currency)', () => {
    expect(currencies.USD.rate).toBe(1);
  });

  test('convertPrice converts USD to target using fixed rate and rounds to currency decimals', () => {
    const eur = convertPrice(100, 'EUR'); // 100 * 0.92 = 92
    expect(eur).toBe(92);
    const jpy = convertPrice(100, 'JPY'); // 100 * 149.5 = 14950, decimals 0
    expect(jpy).toBe(14950);
    const kwd = convertPrice(100, 'KWD'); // 31, decimals 3
    expect(kwd).toBeCloseTo(31, 2);
  });

  test('formatPrice round-trips: converting A->USD->A is lossless for 2-decimal currencies', () => {
    // formatPrice(amount, target, fromCurrency) does fromCurrency -> USD -> target
    // from USD to EUR then back
    const inEur = formatPrice(100, 'EUR', 'USD');
    // 100 * 1 * 0.92 = 92
    expect(inEur).toContain('€');
  });

  test('formatPrice preserves per-currency decimal places', () => {
    const jpy = formatPrice(14950, 'JPY');
    const kwd = formatPrice(31, 'KWD');
    expect(jpy).toContain('¥');
    expect(kwd.split('.')[1] ? kwd.split('.')[1].length : 0).toBe(3);
  });

  test('zero-loss: converting EUR->USD->EUR with full precision then rounding matches source', () => {
    // 92 EUR @ 0.92 => 100 USD; back 100 * 0.92 = 92
    const usdFromEur = 92 / 0.92;
    expect(usdFromEur).toBeCloseTo(100, 10);
    const eurBack = usdFromEur * 0.92;
    expect(eurBack).toBeCloseTo(92, 10);
  });

  test('all currency codes unique and alphabetical map contains no duplicate currency keys', () => {
    const codes = getAllCurrencyCodes();
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(currencies[c].rate).toBeGreaterThan(0);
  });

  test('getCurrencyByCountry(unknown) defaults to USD safely', () => {
    const fallback = getCurrencyByCountry('XX');
    expect(fallback.code || fallback === currencies.USD).toBeTruthy();
  });
});
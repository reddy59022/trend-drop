/**
 * Red tests proving two defects in client/src/utils/helpers.js.
 *
 * DEFECT 1 — prototype-chain currency lookups return NaN (violates this
 *   module's own "never NaN" contract). The `currencies` map is a plain object
 *   literal, so keys like 'constructor', '__proto__', 'toString', 'valueOf',
 *   'hasOwnProperty' resolve to a truthy inherited Object.prototype member.
 *   `currencies[fromCurrency] || currencies.USD` therefore does NOT fall back,
 *   `from.rate` is undefined, and the conversion yields NaN:
 *     convertAmount(100, 'constructor', 'USD') -> NaN   (unknown 'ZZZZ' -> 100)
 *     convertPrice(100, 'constructor')        -> NaN   (unknown 'ZZZZ' -> 100)
 *     convertToUSD(100, 'constructor')        -> NaN
 *     convertBetweenCurrencies(100, 'constructor', 'EUR') -> NaN
 *   (formatPrice* are shielded by normalizeCurrencyCode, and
 *    getCurrencyByCountry by toUpperCase — only the raw convert* are exposed.)
 *
 * DEFECT 2 — validatePhone accepts digit-less garbage. The character class
 *   [\d\s\-+()]{7,20} never requires an actual digit, so '++++++++', '(())()()'
 *   and '--------' all pass as valid phone numbers.
 */
import {
  convertAmount,
  convertPrice,
  convertToUSD,
  convertBetweenCurrencies,
  validatePhone,
} from './helpers';

const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];

describe('DEFECT 1: prototype-chain currency keys must fall back to USD, never NaN', () => {
  test('an unknown currency (ZZZZ) falls back to USD (sanity / existing contract)', () => {
    expect(convertAmount(100, 'ZZZZ', 'USD')).toBe(100);
    expect(convertPrice(100, 'ZZZZ')).toBe(100);
    expect(convertToUSD(100, 'ZZZZ')).toBe(100);
  });

  for (const key of PROTO_KEYS) {
    test(`convertAmount(100, "${key}", 'USD') is finite and equals the unknown fallback`, () => {
      const proto = convertAmount(100, key, 'USD');
      const unknown = convertAmount(100, 'ZZZZ', 'USD');
      expect(Number.isFinite(proto)).toBe(true);
      expect(proto).toBe(unknown);
    });

    test(`convertAmount / convertPrice / convertToUSD / convertBetweenCurrencies never return NaN for "${key}"`, () => {
      const vals = [
        convertAmount(100, 'USD', key),
        convertAmount(100, key, key),
        convertPrice(100, key),
        convertToUSD(100, key),
        convertBetweenCurrencies(100, key, 'EUR'),
        convertBetweenCurrencies(100, 'EUR', key),
      ];
      for (const v of vals) expect(Number.isFinite(v)).toBe(true);
    });
  }
});

describe('DEFECT 2: validatePhone must require digits (reject digit-less garbage)', () => {
  test('sanity: real phone numbers are accepted', () => {
    expect(validatePhone('+1 555 123 4567')).toBe(true);
    expect(validatePhone('5551234')).toBe(true);
    expect(validatePhone('(555) 123-4567')).toBe(true);
  });

  test('digit-less strings are rejected', () => {
    expect(validatePhone('++++++++')).toBe(false);
    expect(validatePhone('--------')).toBe(false);
    expect(validatePhone('(())()()')).toBe(false);
    expect(validatePhone('        ')).toBe(false);
    expect(validatePhone('()--++  ')).toBe(false);
  });

  test('too-few-digit strings are rejected', () => {
    expect(validatePhone('+++')).toBe(false); // too short
    expect(validatePhone('123')).toBe(false); // < 7 digits
    expect(validatePhone('+1 (5)')).toBe(false); // < 7 digits
  });
});

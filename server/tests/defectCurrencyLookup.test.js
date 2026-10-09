/**
 * Red tests: prototype-chain config lookups in the currency + legal maps.
 *
 * Same defect class as tests/defectPrototypeLookup.test.js (payment/boost):
 * object-literal maps keyed by user input fall through to Object.prototype for
 * keys like 'constructor', '__proto__', 'toString', 'valueOf'. Those inherited
 * members are truthy, so `if (!curr)` / `|| default` guards are bypassed and the
 * lookup yields a prototype object whose fields are undefined.
 *
 * Proven defects here:
 *   convertPrice(100, 'constructor')        -> NaN        (unknown 'ZZZZ' -> 100)
 *   formatPrice(100, 'constructor')         -> "undefined100.00"  (unknown -> "$100.00")
 *   getCurrencyByCountry('constructor')     -> undefined  (unknown -> currencies.USD)
 *   getDocument('constructor')              -> {version: Function, title: undefined}  (unknown -> null)
 *
 * The fix makes the user-keyed maps null-prototype so ANY non-configured key
 * falls back exactly like an unknown key.
 */
const { convertPrice, formatPrice, getCurrencyByCountry, currencies } = require('../config/currencies');
const { getDocument, getCountryPolicy } = require('../config/legal');

const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];

describe('DEFECT: prototype-chain currency/legal config keys must fall back like unknown keys', () => {
  describe('convertPrice (currency keyed by user-supplied code)', () => {
    test('an unknown currency (ZZZZ) returns the USD amount unchanged (sanity)', () => {
      expect(convertPrice(100, 'ZZZZ')).toBe(100);
    });
    for (const key of PROTO_KEYS) {
      test(`convertPrice(100, "${key}") is finite and equals the unknown-currency fallback`, () => {
        const proto = convertPrice(100, key);
        const unknown = convertPrice(100, 'ZZZZ');
        expect(Number.isFinite(proto)).toBe(true);
        expect(proto).toBe(unknown);
      });
    }
  });

  describe('formatPrice (currency keyed by user-supplied code)', () => {
    test('an unknown currency (ZZZZ) renders the "$" fallback (sanity)', () => {
      expect(formatPrice(100, 'ZZZZ')).toBe('$100.00');
    });
    for (const key of PROTO_KEYS) {
      test(`formatPrice(100, "${key}") equals the unknown-currency fallback (no "undefined")`, () => {
        const proto = formatPrice(100, key);
        const unknown = formatPrice(100, 'ZZZZ');
        expect(proto).toBe(unknown);
        expect(proto).not.toContain('undefined');
      });
    }
  });

  describe('getCurrencyByCountry (country keyed by user-supplied code)', () => {
    test('an unknown country (ZZZZ) returns currencies.USD (sanity)', () => {
      expect(getCurrencyByCountry('ZZZZ')).toBe(currencies.USD);
    });
    for (const key of PROTO_KEYS) {
      test(`getCurrencyByCountry("${key}") returns currencies.USD, never undefined`, () => {
        const proto = getCurrencyByCountry(key);
        expect(proto).toBe(currencies.USD);
      });
    }
  });

  describe('getDocument (legal doc keyed by user-supplied type)', () => {
    test('an unknown type (nope) returns null (sanity)', () => {
      expect(getDocument('nope')).toBe(null);
    });
    for (const key of PROTO_KEYS) {
      test(`getDocument("${key}") returns null (not a malformed doc)`, () => {
        expect(getDocument(key)).toBe(null);
      });
    }
  });

  describe('getCountryPolicy (regression guard)', () => {
    test('prototype keys return the review_required fallback', () => {
      for (const key of PROTO_KEYS) {
        const p = getCountryPolicy(key);
        expect(p.status).toBe('review_required');
      }
    });
  });
});

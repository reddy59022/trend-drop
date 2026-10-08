/**
 * Red tests proving defects in the tax engine (config/tax.js).
 *
 * DEFECT 1 — non-US `sales_tax` countries resolve to 0%.
 *   `taxRules.MY` (Malaysia SST) is configured with `standardRate: 0.10`,
 *   but `getTaxRate('MY')` returns 0. Root cause: `getTaxRate`'s switch has a
 *   DUPLICATE `case 'sales_tax'`. The first branch (the US-style branch) reads
 *   `countryRule.countryRate` — which Malaysia does not define — so it falls
 *   back to `|| 0`. The second `case 'sales_tax'` (which reads `standardRate`,
 *   i.e. the Malaysia/SST branch) is UNREACHABLE dead code. Any sales-tax
 *   country without a `states`/`countryRate` map therefore charges 0 tax.
 *
 * These tests pin the correct behaviour: every configured country must
 * resolve to the rate its rule declares, regardless of `type`.
 */
const { getTaxRate, calculateTax, taxRules } = require('../config/tax');

describe('DEFECT 1: non-US sales_tax countries must use their configured standardRate', () => {
  test('Malaysia (MY, sales_tax, standardRate 0.10) resolves to 10%, not 0%', () => {
    const result = getTaxRate('MY');
    expect(result.rate).toBeCloseTo(0.10, 5);
    expect(result.type).toBe('sales_tax');
  });

  test('Malaysia tax on a 100 item is 10, not 0', () => {
    const result = calculateTax('MY', null, 100);
    expect(result.taxAmount).toBeCloseTo(10, 2);
    expect(result.taxRate).toBeCloseTo(0.10, 5);
  });

  test('every sales_tax country that declares standardRate resolves to it (not 0)', () => {
    const salesTaxCountries = Object.entries(taxRules)
      .filter(([, rule]) => rule.type === 'sales_tax' && typeof rule.standardRate === 'number');
    // Guard: the fixture must actually contain at least one such country,
    // otherwise this test would vacuously pass.
    expect(salesTaxCountries.length).toBeGreaterThan(0);
    for (const [code, rule] of salesTaxCountries) {
      expect(getTaxRate(code).rate).toBeCloseTo(rule.standardRate, 5);
    }
  });

  test('REGRESSION GUARD: US state rates are unchanged (stateless US has no federal rate)', () => {
    expect(getTaxRate('US', 'CA').rate).toBeCloseTo(0.0725, 5);
    expect(getTaxRate('US', 'NY').rate).toBeCloseTo(0.04, 5);
    expect(getTaxRate('US').rate).toBe(0); // no federal sales tax
  });

  test('REGRESSION GUARD: reduced-rate categories still work for real reduced rates (GB food = 5%)', () => {
    expect(getTaxRate('GB', null, 100, 'food').rate).toBeCloseTo(0.05, 5);
  });
});

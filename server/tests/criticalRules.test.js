const {
  isValidMoneyInput,
  isPositiveIntegerQuantity,
  isValidInventoryQuantity,
  isValidAutoReorderPatch,
  isSuspendedRole,
} = require('../criticalRules');

describe('critical payment, inventory, and authorization rules', () => {
  describe('payment money validation', () => {
    test.each([
      ['string', '10'],
      ['object', {}],
      ['array', []],
      ['nan', NaN],
      ['infinity', Infinity],
      ['negative', -0.01],
      ['above maximum', 101],
    ])('rejects %s', (_label, value) => {
      expect(isValidMoneyInput(value, 100)).toBe(false);
    });

    test.each([0, 0.01, 100])('accepts finite non-negative value %s within max', (value) => {
      expect(isValidMoneyInput(value, 100)).toBe(true);
    });
  });

  describe('payment quantity validation', () => {
    test.each([undefined, null, '1', {}, [], true, NaN, Infinity, 0, -1, 1.5])(
      'rejects invalid quantity %j',
      (value) => expect(isPositiveIntegerQuantity(value)).toBe(false),
    );

    test.each([1, 2, 1000000])('accepts positive integer quantity %s', (value) => {
      expect(isPositiveIntegerQuantity(value)).toBe(true);
    });
  });

  describe('inventory quantity validation', () => {
    test.each([NaN, Infinity, -1, 1000001, '4', null, undefined])(
      'rejects invalid inventory quantity %j',
      (value) => expect(isValidInventoryQuantity(value)).toBe(false),
    );

    test.each([0, 1, 1000000])('accepts bounded inventory quantity %s', (value) => {
      expect(isValidInventoryQuantity(value)).toBe(true);
    });
  });

  describe('inventory auto-reorder patch validation', () => {
    test.each([
      { enabled: 'yes' },
      { enabled: 1 },
      { quantity: 'five' },
      { quantity: NaN },
      { quantity: Infinity },
      { supplier: 123 },
      { supplier: {} },
    ])('rejects %j', (patch) => {
      expect(isValidAutoReorderPatch(patch)).toBe(false);
    });

    test.each([
      {},
      { enabled: true },
      { enabled: false, quantity: 0, supplier: null },
      { quantity: 5, supplier: 'Acme' },
    ])('accepts %j', (patch) => {
      expect(isValidAutoReorderPatch(patch)).toBe(true);
    });
  });

  describe('authorization role validation', () => {
    test('only suspended role is blocked', () => {
      expect(isSuspendedRole('suspended')).toBe(true);
      expect(isSuspendedRole('user')).toBe(false);
      expect(isSuspendedRole('admin')).toBe(false);
      expect(isSuspendedRole(undefined)).toBe(false);
      expect(isSuspendedRole(null)).toBe(false);
    });
  });
});

/**
 * Red tests proving a prototype-chain config-lookup defect.
 *
 * DEFECT — object-literal config maps keyed by user input fall through to
 *   Object.prototype for keys like 'constructor', '__proto__', 'toString',
 *   'valueOf', 'hasOwnProperty'. Because those inherited members are truthy,
 *   the `|| default` fallback is bypassed and the lookup yields a prototype
 *   object (or a function) whose .platformFee/.feePercent/.price are
 *   `undefined`, so every downstream money figure becomes NaN.
 *
 *   A normal unknown country/tier ('ZZ', 'foo') correctly falls back to the
 *   default; only prototype-chain keys break it. The fix makes the user-keyed
 *   maps null-prototype so ANY non-configured key falls back exactly like an
 *   unknown key.
 *
 * Surfaces proven here (money-critical):
 *   1. calculatePaymentBreakdown  -> NaN platformFee / buyerProtection / earnings
 *   2. calculateBoostFee          -> NaN boost fee
 */
const { calculatePaymentBreakdown } = require('../config/payments');
const { calculateBoostFee, boostConfig } = require('../config/boost');

const PROTO_KEYS = ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'];

describe('DEFECT: prototype-chain config keys must fall back to defaults, not NaN', () => {
  describe('calculatePaymentBreakdown (commission keyed by country)', () => {
    test('an unknown country (ZZ) falls back to default and is finite (sanity)', () => {
      const b = calculatePaymentBreakdown(100, 'ZZ', 'ZZ', 1);
      expect(Number.isFinite(b.seller.platformFee)).toBe(true);
    });

    for (const key of PROTO_KEYS) {
      test(`country "${key}" behaves exactly like an unknown country (no NaN)`, () => {
        const proto = calculatePaymentBreakdown(100, key, key, 1);
        const unknown = calculatePaymentBreakdown(100, 'ZZ', 'ZZ', 1);

        // Money must be finite, never NaN.
        expect(Number.isFinite(proto.seller.platformFee)).toBe(true);
        expect(Number.isFinite(proto.buyer.buyerProtectionFee)).toBe(true);
        expect(Number.isFinite(proto.seller.sellerEarnings)).toBe(true);

        // And must equal the default-fallback figures a normal unknown key gets.
        expect(proto.seller.platformFee).toBe(unknown.seller.platformFee);
        expect(proto.buyer.buyerProtectionFee).toBe(unknown.buyer.buyerProtectionFee);
        expect(proto.seller.sellerEarnings).toBe(unknown.seller.sellerEarnings);
      });
    }

    test('mixed: seller uses a prototype key, buyer uses a real country', () => {
      const b = calculatePaymentBreakdown(100, '__proto__', 'US', 1);
      expect(Number.isFinite(b.seller.platformFee)).toBe(true);
      expect(Number.isFinite(b.seller.sellerEarnings)).toBe(true);
    });
  });

  describe('calculateBoostFee (boost tier keyed by user-supplied tier)', () => {
    test('an unknown tier (foo) falls back to standard and is finite (sanity)', () => {
      const b = calculateBoostFee(100, 'foo', 14);
      expect(Number.isFinite(b.fee)).toBe(true);
    });

    for (const key of PROTO_KEYS) {
      test(`tier "${key}" behaves exactly like an unknown tier (no NaN)`, () => {
        const proto = calculateBoostFee(100, key, 14);
        const standard = calculateBoostFee(100, 'standard', 14);
        const unknown = calculateBoostFee(100, 'foo', 14);

        expect(Number.isFinite(proto.fee)).toBe(true);
        expect(Number.isFinite(proto.totalUpfrontCost)).toBe(true);
        // Falls back to the standard tier, exactly like any unknown tier.
        expect(proto.fee).toBe(unknown.fee);
        expect(proto.fee).toBe(standard.fee);
      });
    }

    test('boost tier lookup on a prototype key yields the standard tier config', () => {
      // Direct map lookup must not return Object.prototype for these keys.
      for (const key of PROTO_KEYS) {
        const t = boostConfig.tiers[key];
        expect(t === undefined || t === boostConfig.tiers.standard).toBe(true);
      }
    });
  });
});

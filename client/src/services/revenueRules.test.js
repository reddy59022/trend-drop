import {
  roundMoney,
  normalizeQuantity,
  calculateBuyerLine,
  calculateSellerNet,
  calculateBuyerTotal,
  calculatePlatformNet,
  calculateDiscountedSellerNet,
  reconcileItemLedger,
  calculateRefundSettlement,
} from './revenueRules';

describe('client revenue rules', () => {
  test.each([
    [10.005, 10.01],
    [10.004, 10],
    [0, 0],
  ])('rounds money to cents', (value, expected) => {
    expect(roundMoney(value)).toBe(expected);
  });

  test.each([[1, 1], [2, 2], [0, 1], [-1, 1], [1.5, 1], ['2', 1]])(
    'normalizes quantity %j to %s',
    (value, expected) => expect(normalizeQuantity(value)).toBe(expected),
  );

  test('customer pays one shipping line plus per-unit item and protection charges', () => {
    expect(calculateBuyerLine({ buyer: { itemPrice: 50, shippingCost: 4.5, buyerProtectionFee: 2.5 } }, 2))
      .toEqual({ itemPrice: 100, shippingCost: 4.5, protectionFee: 5, total: 109.5 });
  });

  test('missing buyer breakdown is a safe zero-money line', () => {
    expect(calculateBuyerLine(null, 2)).toEqual({
      itemPrice: 0,
      shippingCost: 0,
      protectionFee: 0,
      total: 0,
    });
  });

  test('seller net excludes shipping and buyer protection', () => {
    expect(calculateSellerNet(100, 8, 3)).toBe(89);
    expect(calculateSellerNet(100, 8)).toBe(92);
    expect(calculateSellerNet(5, 8, 3)).toBe(0);
  });

  test('buyer discount applies only after shipping and protection are computed', () => {
    expect(calculateBuyerTotal(100, 10, 5, 20)).toBe(95);
    expect(calculateBuyerTotal(100, 10, 5)).toBe(115);
  });

  test('customer charge accounts for every gross leg without dropping shipping or protection', () => {
    const input = {
      itemPrice: 100,
      shippingCost: 12,
      buyerProtectionFee: 5,
      platformFee: 8,
      boostFee: 3,
      providerFee: 3.69,
      discount: 10,
    };
    const ledger = reconcileItemLedger(input);
    expect(ledger.customerCharge).toBe(Math.round(
      (ledger.itemLedger + input.shippingCost + input.buyerProtectionFee) * 100,
    ) / 100);
    expect(ledger.platformGross).toBe(Math.round((input.platformFee + input.buyerProtectionFee) * 100) / 100);
  });

  test('platform net is fee revenue minus provider cost', () => {
    expect(calculatePlatformNet(8, 5, 3.69)).toBe(9.31);
    expect(calculatePlatformNet(8, 5, 30)).toBe(-17);
  });

  test('seller-funded discounts reduce only the eligible seller subtotal', () => {
    expect(calculateDiscountedSellerNet(100, 8, 10)).toEqual({
      discountedSubtotal: 90,
      platformFee: 7.2,
      sellerEarnings: 82.8,
    });
    expect(calculateDiscountedSellerNet(100, 8, 150)).toEqual({
      discountedSubtotal: 0,
      platformFee: 0,
      sellerEarnings: 0,
    });
  });

  test('item ledger closes exactly at the cent', () => {
    const seller = calculateSellerNet(75, 6, 7.5);
    expect(roundMoney(seller + 6 + 7.5)).toBe(75);
  });

  test.each([
    [{ itemPrice: 100, shippingCost: 12, buyerProtectionFee: 5, platformFee: 8, boostFee: 3, providerFee: 3.69, discount: 10 }, 107, 79, 13, 9.31, 90],
    [{ itemPrice: 40, shippingCost: 0, buyerProtectionFee: 2, platformFee: 3.2, boostFee: 0, providerFee: 1, discount: 0 }, 42, 36.8, 5.2, 4.2, 40],
  ])('keeps customer charge and item ledger in sync (%j)', (input, customerCharge, sellerEarnings, platformGross, platformNet, itemLedger) => {
    expect(reconcileItemLedger(input)).toMatchObject({ customerCharge, sellerEarnings, platformGross, platformNet, itemLedger });
    expect(reconcileItemLedger(input).itemLedger).toBe(input.itemPrice - input.discount);
  });

  test('refund settlement is full-capture and quantity preserving', () => {
    expect(calculateRefundSettlement({ totalPaid: 117, sellerEarnings: 89, inventoryQuantity: 3 }))
      .toEqual({ buyerRefund: 117, sellerClawback: 89, restoredQuantity: 3 });
    expect(calculateRefundSettlement({ totalPaid: -1, sellerEarnings: -2, inventoryQuantity: 0 }))
      .toEqual({ buyerRefund: 0, sellerClawback: 0, restoredQuantity: 1 });
  });

  test('defaults missing optional money legs without creating or losing customer funds', () => {
    expect(reconcileItemLedger({ itemPrice: 25, platformFee: 2 })).toEqual({
      discountedItem: 25,
      customerCharge: 25,
      sellerEarnings: 23,
      platformGross: 2,
      platformNet: 2,
      itemLedger: 25,
    });
    expect(calculateRefundSettlement({ totalPaid: 25, sellerEarnings: 23 }))
      .toEqual({ buyerRefund: 25, sellerClawback: 23, restoredQuantity: 1 });
  });
});

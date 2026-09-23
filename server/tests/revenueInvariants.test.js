const {
  roundMoney,
  calculateSellerNet,
  calculateBuyerTotal,
  calculatePlatformNet,
  allocateDiscountedSellerNet,
  reconcileItemLedger,
  calculateRefundSettlement,
} = require('../criticalRules');

describe('revenue invariants — customer, seller, and platform', () => {
  test('rounds every ledger leg to cents', () => {
    expect(roundMoney(10.005)).toBe(10.01);
    expect(roundMoney(10.004)).toBe(10);
  });

  test('seller net never includes shipping or buyer protection', () => {
    expect(calculateSellerNet(100, 8, 3)).toBe(89);
    expect(calculateSellerNet(100, 8, 0)).toBe(92);
  });

  test('customer charge includes item, one shipping charge, protection, and discount', () => {
    expect(calculateBuyerTotal(100, 12, 5, 10)).toBe(107);
    expect(calculateBuyerTotal(100, 12, 5, 0)).toBe(117);
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
    expect(ledger.customerCharge).toBe(roundMoney(
      ledger.itemLedger + input.shippingCost + input.buyerProtectionFee,
    ));
    expect(ledger.platformGross).toBe(roundMoney(input.platformFee + input.buyerProtectionFee));
  });

  test('platform net is gross fees minus provider fee, never seller funds', () => {
    expect(calculatePlatformNet(8, 5, 3.69)).toBe(9.31);
    expect(calculatePlatformNet(8, 5, 30)).toBe(-17);
  });

  test('seller-funded discount cannot reduce another seller or create seller earnings', () => {
    expect(allocateDiscountedSellerNet(100, 8, 10)).toEqual({
      discountedSubtotal: 90,
      platformFee: 7.2,
      sellerEarnings: 82.8,
    });
    expect(allocateDiscountedSellerNet(100, 8, 150)).toEqual({
      discountedSubtotal: 0,
      platformFee: 0,
      sellerEarnings: 0,
    });
  });

  test('the three ledgers reconcile at the item level', () => {
    const item = 75;
    const platformFee = 6;
    const boostFee = 7.5;
    const seller = calculateSellerNet(item, platformFee, boostFee);
    expect(roundMoney(seller + platformFee + boostFee)).toBe(item);
  });

  test.each([
    [{ itemPrice: 100, shippingCost: 12, buyerProtectionFee: 5, platformFee: 8, boostFee: 3, providerFee: 3.69, discount: 10 }, 107, 79, 13, 9.31, 90],
    [{ itemPrice: 40, shippingCost: 0, buyerProtectionFee: 2, platformFee: 3.2, boostFee: 0, providerFee: 1, discount: 0 }, 42, 36.8, 5.2, 4.2, 40],
  ])('reconciles customer, seller, and platform legs without losing item funds', (input, customerCharge, sellerEarnings, platformGross, platformNet, itemLedger) => {
    expect(reconcileItemLedger(input)).toMatchObject({ customerCharge, sellerEarnings, platformGross, platformNet, itemLedger });
    expect(reconcileItemLedger(input).itemLedger).toBe(input.itemPrice - input.discount);
  });

  test('refund settlement returns the captured customer amount and exact seller clawback', () => {
    expect(calculateRefundSettlement({ totalPaid: 117, sellerEarnings: 89, inventoryQuantity: 3 }))
      .toEqual({ buyerRefund: 117, sellerClawback: 89, restoredQuantity: 3 });
    expect(calculateRefundSettlement({ totalPaid: -1, sellerEarnings: -2, inventoryQuantity: 0 }))
      .toEqual({ buyerRefund: 0, sellerClawback: 0, restoredQuantity: 1 });
  });

  test('defaults missing optional money legs to zero without changing customer funds', () => {
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

import { calculateCartDisplayLine } from './Cart';

describe('cart display financials', () => {
  test('charges combined shipping once while scaling item and protection fees', () => {
    const line = calculateCartDisplayLine({
      buyer: { itemPrice: 100, shippingCost: 12, buyerProtectionFee: 5 },
    }, 3);

    expect(line).toEqual({
      itemPrice: 300,
      shippingCost: 12,
      protectionFee: 15,
      total: 327,
    });
  });

  test('normalizes invalid quantities instead of showing a zero-money line', () => {
    expect(calculateCartDisplayLine({ buyer: { itemPrice: 20, shippingCost: 5, buyerProtectionFee: 1 } }, 0).total).toBe(26);
    expect(calculateCartDisplayLine({ buyer: { itemPrice: 20, shippingCost: 5, buyerProtectionFee: 1 } }, 1.5).total).toBe(26);
  });
});

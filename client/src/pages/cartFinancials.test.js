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

  test.each([
    [1, 50, 4.5, 2.5, 57],
    [2, 50, 4.5, 2.5, 109.5],
    [3, 19.99, 7.25, 1, 70.22],
  ])('keeps customer total equal to item + one shipping + per-unit protection (%s units)', (qty, item, shipping, protection, total) => {
    const line = calculateCartDisplayLine({ buyer: { itemPrice: item, shippingCost: shipping, buyerProtectionFee: protection } }, qty);
    expect(line.total).toBe(total);
    expect(line.total).toBeCloseTo(line.itemPrice + line.shippingCost + line.protectionFee, 2);
  });

  test('does not let a seller-funded discount alter shipping or protection math', () => {
    const line = calculateCartDisplayLine({
      buyer: { itemPrice: 100, shippingCost: 10, buyerProtectionFee: 5 },
    }, 2);
    const discount = 20;
    expect(line.shippingCost).toBe(10);
    expect(line.protectionFee).toBe(10);
    expect(Math.round((line.total - discount) * 100) / 100).toBe(200);
  });
});

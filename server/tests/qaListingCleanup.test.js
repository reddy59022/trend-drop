/**
 * QA/E2E catalog junk detection — cleanup safety contract.
 *
 * The matcher decides what gets DELETED from the production catalog, so its
 * contract is: match unmistakable test artifacts, never a real seller's
 * listing. These tests pin both directions.
 */
const { isQaJunkTitle, planQaCleanup } = require('../utils/qaListingCleanup');

describe('isQaJunkTitle — matches unmistakable test inventory', () => {
  test.each([
    'PROD-E2E 20260911 checkout flow item',
    'PROD-E2E-20260911-0001',
    'E2E-checkout-123',
    'E2E_cart_flow_2',
    'QA Test Item',
    'QA Test Item 3',
    'TD QA listing created by audit',
    '$32_20260915094524_prod3 return-item',
    '1234_20260915094524_prod3',
  ])('flags %j', (title) => {
    expect(isQaJunkTitle(title)).toBe(true);
  });
});

describe('isQaJunkTitle — never flags real inventory', () => {
  test.each([
    'Vintage Levi\u2019s 501 Jeans — W32',
    'Nike Air Max 90, barely worn',
    'Elegant black evening dress',
    'QA themed party dress', // "QA" inside a word-ish phrase is not the QA prefix
    'Prodigy brand skateboard deck', // "Prod…" is not "PROD-E2E"
    'Testoni leather loafers', // "Testoni" is a real brand
    'My old test kitchen apron',
    'iPhone 13 Pro 256GB',
    '',
    '   ',
  ])('does not flag %j', (title) => {
    expect(isQaJunkTitle(title)).toBe(false);
  });

  test('rejects non-string input instead of throwing', () => {
    expect(isQaJunkTitle(undefined)).toBe(false);
    expect(isQaJunkTitle(null)).toBe(false);
    expect(isQaJunkTitle(42)).toBe(false);
    expect(isQaJunkTitle({ title: 'PROD-E2E x' })).toBe(false);
  });
});

describe('planQaCleanup — commerce history protects junk from silent deletion', () => {
  const listings = [
    { _id: '1', title: 'PROD-E2E 20260911 checkout flow item' },
    { _id: '2', title: 'QA Test Item 7' },
    { _id: '3', title: 'Vintage Levi\u2019s 501 Jeans' },
    { _id: '4', title: '$32_20260915094524_prod3 return-item' },
  ];

  test('separates clean junk from junk with related data', () => {
    const { deletable, needsReview } = planQaCleanup(
      listings,
      (l) => l._id === '2' // QA Test Item 7 has orders
    );
    expect(deletable.map((l) => l._id)).toEqual(['1', '4']);
    expect(needsReview.map((l) => l._id)).toEqual(['2']);
  });

  test('real listings never appear in either deletion bucket', () => {
    const { deletable, needsReview } = planQaCleanup(listings, () => false);
    const ids = [...deletable, ...needsReview].map((l) => l._id);
    expect(ids).not.toContain('3');
  });

  test('empty input plans nothing', () => {
    expect(planQaCleanup([], () => false)).toEqual({ deletable: [], needsReview: [] });
  });
});

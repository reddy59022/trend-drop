/**
 * PROD/IN-MEMORY E2E — 35: revenue zero-sum ledger.
 *
 * This deliberately checks the money contract at the API boundary rather than
 * trusting a single response: the customer charge, seller escrow, platform
 * commission, payout row, refund, and inventory restoration must all reconcile
 * to cents for one complete sale and cancellation.
 */
const { test } = require('@playwright/test');
const { makeApi, cents, RUN_ID, IS_PROD, expect } = require('./helpers');

const SHIPPING = {
  fullName: 'Revenue Invariant Buyer', street1: '35 Ledger Way', city: 'Austin',
  state: 'TX', postalCode: '78701', country: 'US', phone: '+15555550035',
};

const describeRevenue = IS_PROD ? test.describe.skip : test.describe;

describeRevenue('35 · customer/seller/platform revenue invariants', () => {
  let api;
  let sellerToken;
  let buyerToken;
  let listingId;
  let transactionId;
  let beforeSeller;
  let sale;

  test.beforeAll(async () => {
    api = await makeApi();
    sellerToken = await api.login('alex');
    buyerToken = await api.login('jordan');

    const baseline = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(baseline.status).toBe(200);
    beforeSeller = {
      pending: Number(baseline.data.balance?.pending || 0),
      available: Number(baseline.data.balance?.available || 0),
    };

    const listing = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S35 revenue invariant ${RUN_ID}`,
        description: 'Financial ledger invariant test',
        price: 120,
        category: 'Men', brand: 'Ledger', size: 'M',
        condition: 'New with tags', color: 'Black', quantity: 2,
        shipsFrom: 'US', currency: 'USD',
      },
    });
    expect(listing.status, JSON.stringify(listing.data)).toBe(201);
    listingId = String((listing.data.listing || listing.data)._id);
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test('sale reconciles customer charge, seller escrow, platform fee, and payout', async () => {
    const intent = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId, quantity: 1 }], shippingAddress: SHIPPING, buyerCountry: 'US' },
    });
    expect(intent.status, JSON.stringify(intent.data)).toBe(200);

    const authorized = await api.req('post', '/api/payments/test-confirm', {
      token: buyerToken,
      body: { paymentIntentId: intent.data.paymentIntentId },
    });
    expect(authorized.status, JSON.stringify(authorized.data)).toBe(200);

    const confirmed = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken,
      body: {
        paymentIntentId: intent.data.paymentIntentId,
        items: [{ listingId, quantity: 1 }],
        shippingAddress: SHIPPING,
      },
    });
    expect(confirmed.status, JSON.stringify(confirmed.data)).toBe(201);
    sale = confirmed.data.transactions[0];
    const saleId = sale?._id || sale?.id || sale?.transactionId;
    expect(saleId, `sale transaction id missing: ${JSON.stringify(sale)}`).toBeTruthy();
    transactionId = String(saleId);

    const bd = sale.paymentBreakdown;
    const item = cents(bd.subtotal);
    const shipping = cents(bd.shippingCost);
    const protection = cents(bd.buyerProtectionFee);
    const customerCharge = cents(bd.totalPaid);
    const platformFee = cents(bd.platformFee);
    const boost = cents(bd.boostFee || 0);
    const sellerEarnings = cents(bd.sellerEarnings);

    // Customer is charged exactly the customer-facing components, once.
    expect(customerCharge).toBe(cents(item + shipping + protection));
    expect(cents(intent.data.amount)).toBe(customerCharge);
    // Seller/platform split the item subtotal; shipping is a pass-through.
    expect(cents(sellerEarnings + platformFee + boost)).toBe(item);
    expect(sellerEarnings).toBeGreaterThan(0);
    expect(platformFee).toBeGreaterThan(0);

    const sellerAfter = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(sellerAfter.status).toBe(200);
    expect(cents(sellerAfter.data.balance.pending - beforeSeller.pending)).toBe(sellerEarnings);

    const payout = await api.req('get', '/api/payouts/dashboard', { token: sellerToken });
    expect(payout.status).toBe(200);
    const matching = (payout.data.recentTransactions || payout.data.transactions || [])
      .find((row) => String(row.transaction?._id || row.transaction || row._id) === transactionId);
    expect(matching, 'seller dashboard must expose the sale payout').toBeTruthy();
    expect(cents(matching.payoutAmount || matching.amount || sellerEarnings)).toBe(sellerEarnings);

    const listingAfter = await api.req('get', `/api/listings/${listingId}`);
    expect(listingAfter.status).toBe(200);
    expect(listingAfter.data.listing.quantity).toBe(1);
    expect(listingAfter.data.listing.quantitySold).toBe(1);
  });

  test('multi-item checkout reconciles every customer, seller, and platform ledger leg', async () => {
    const first = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S35 revenue invariant multi-first ${RUN_ID}`,
        description: 'First item for multi-item conservation',
        price: 60,
        category: 'Men', brand: 'Ledger', size: 'M',
        condition: 'New with tags', color: 'Gray', quantity: 1,
        shipsFrom: 'US', currency: 'USD',
      },
    });
    expect(first.status, JSON.stringify(first.data)).toBe(201);
    const firstId = String((first.data.listing || first.data)._id);

    const second = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S35 revenue invariant second ${RUN_ID}`,
        description: 'Second item for multi-item conservation',
        price: 80,
        category: 'Men', brand: 'Ledger', size: 'L',
        condition: 'New with tags', color: 'Navy', quantity: 1,
        shipsFrom: 'US', currency: 'USD',
      },
    });
    expect(second.status, JSON.stringify(second.data)).toBe(201);
    const secondId = String((second.data.listing || second.data)._id);
    const before = await api.req('get', '/api/users/me', { token: sellerToken });
    const intent = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId: firstId, quantity: 1 }, { listingId: secondId, quantity: 1 }], shippingAddress: SHIPPING, buyerCountry: 'US' },
    });
    expect(intent.status, JSON.stringify(intent.data)).toBe(200);
    await api.req('post', '/api/payments/test-confirm', { token: buyerToken, body: { paymentIntentId: intent.data.paymentIntentId } });
    const confirmed = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken,
      body: { paymentIntentId: intent.data.paymentIntentId, items: [{ listingId: firstId, quantity: 1 }, { listingId: secondId, quantity: 1 }], shippingAddress: SHIPPING },
    });
    expect(confirmed.status, JSON.stringify(confirmed.data)).toBe(201);
    expect(confirmed.data.transactions).toHaveLength(2);

    const totals = confirmed.data.transactions.reduce((sum, transaction) => {
      const bd = transaction.paymentBreakdown;
      expect(cents(bd.sellerEarnings + bd.platformFee + (bd.boostFee || 0))).toBe(cents(bd.subtotal));
      return sum + cents(bd.totalPaid);
    }, 0);
    expect(cents(totals)).toBe(cents(intent.data.amount));
    expect(cents(confirmed.data.orders[0].totals.total)).toBe(cents(intent.data.amount));

    const after = await api.req('get', '/api/users/me', { token: sellerToken });
    const expectedSellerDelta = confirmed.data.transactions.reduce((sum, transaction) => sum + transaction.paymentBreakdown.sellerEarnings, 0);
    expect(cents(after.data.balance.pending - before.data.balance.pending)).toBe(cents(expectedSellerDelta));

    // Unwind both transactions and prove each item returns to its exact pre-sale state.
    for (const transaction of confirmed.data.transactions) {
      const cancelled = await api.req('post', `/api/orders/${transaction._id}/cancel`, { token: buyerToken, body: { reason: 'S35 multi-item cleanup' } });
      expect(cancelled.status, JSON.stringify(cancelled.data)).toBe(200);
      expect(cents(cancelled.data.refundAmount)).toBe(cents(transaction.paymentBreakdown.totalPaid));
    }
    const restoredSeller = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(cents(restoredSeller.data.balance.pending - before.data.balance.pending)).toBe(0);
    for (const id of [firstId, secondId]) {
      const restored = await api.req('get', `/api/listings/${id}`);
      expect(restored.status).toBe(200);
      expect(restored.data.listing.quantity).toBe(1);
      expect(restored.data.listing.quantitySold).toBe(0);
      expect(restored.data.listing.available).toBe(true);
    }
  });

  test('pre-shipment cancellation is a complete zero-sum unwind', async () => {
    const cancelled = await api.req('post', `/api/orders/${transactionId}/cancel`, {
      token: buyerToken,
      body: { reason: 'S35 invariant cleanup' },
    });
    expect(cancelled.status, JSON.stringify(cancelled.data)).toBe(200);
    expect(cents(cancelled.data.refundAmount)).toBe(cents(sale.paymentBreakdown.totalPaid));
    expect(cancelled.data.refundType).toBe('full');

    const sellerAfter = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(sellerAfter.status).toBe(200);
    expect(cents(sellerAfter.data.balance.pending)).toBe(cents(beforeSeller.pending));
    expect(cents(sellerAfter.data.balance.available)).toBe(cents(beforeSeller.available));

    const listingAfter = await api.req('get', `/api/listings/${listingId}`);
    expect(listingAfter.status).toBe(200);
    expect(listingAfter.data.listing.quantity).toBe(2);
    expect(listingAfter.data.listing.quantitySold).toBe(0);
    expect(listingAfter.data.listing.sold).toBe(false);
    expect(listingAfter.data.listing.available).toBe(true);
  });

  test('paid shipping is a fully accounted pass-through and is refunded exactly once', async () => {
    const before = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(before.status).toBe(200);

    const listing = await api.req('post', '/api/listings', {
      token: sellerToken,
      body: {
        title: `S35 paid shipping ${RUN_ID}`,
        description: 'Paid shipping revenue conservation test',
        price: 20,
        category: 'Men', brand: 'Ledger', size: 'S',
        condition: 'New with tags', color: 'White', quantity: 1,
        weight: 5, shipsFrom: 'US', currency: 'USD',
      },
    });
    expect(listing.status, JSON.stringify(listing.data)).toBe(201);
    const paidShippingListingId = String((listing.data.listing || listing.data)._id);

    const intent = await api.req('post', '/api/payments/create-intent', {
      token: buyerToken,
      body: { items: [{ listingId: paidShippingListingId, quantity: 1 }], shippingAddress: SHIPPING, buyerCountry: 'US' },
    });
    expect(intent.status, JSON.stringify(intent.data)).toBe(200);
    await api.req('post', '/api/payments/test-confirm', {
      token: buyerToken,
      body: { paymentIntentId: intent.data.paymentIntentId },
    });

    const confirmed = await api.req('post', '/api/payments/confirm-batch', {
      token: buyerToken,
      body: {
        paymentIntentId: intent.data.paymentIntentId,
        items: [{ listingId: paidShippingListingId, quantity: 1 }],
        shippingAddress: SHIPPING,
      },
    });
    expect(confirmed.status, JSON.stringify(confirmed.data)).toBe(201);
    const transaction = confirmed.data.transactions[0];
    const bd = transaction.paymentBreakdown;
    const gross = cents(bd.totalPaid);
    const item = cents(bd.subtotal);
    const shipping = cents(bd.shippingCost);
    const protection = cents(bd.buyerProtectionFee);
    const seller = cents(bd.sellerEarnings);
    const platform = cents(bd.platformFee);
    const boost = cents(bd.boostFee || 0);

    expect(shipping).toBeGreaterThan(0);
    expect(cents(bd.shippingPayout)).toBe(shipping);
    expect(gross).toBe(cents(item + shipping + protection));
    // Every customer-paid cent is assigned: item → seller/platform/boost,
    // shipping → shipping payout, protection → platform gross.
    expect(cents(seller + platform + boost + shipping + protection)).toBe(gross);

    const sellerAfter = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(sellerAfter.status).toBe(200);
    expect(cents(sellerAfter.data.balance.pending - before.data.balance.pending)).toBe(seller);

    const cancelled = await api.req('post', `/api/orders/${transaction._id}/cancel`, {
      token: buyerToken,
      body: { reason: 'S35 paid shipping cleanup' },
    });
    expect(cancelled.status, JSON.stringify(cancelled.data)).toBe(200);
    expect(cents(cancelled.data.refundAmount)).toBe(gross);

    const restoredSeller = await api.req('get', '/api/users/me', { token: sellerToken });
    expect(Math.abs(cents(restoredSeller.data.balance.pending - before.data.balance.pending))).toBe(0);
    const restoredListing = await api.req('get', `/api/listings/${paidShippingListingId}`);
    expect(restoredListing.status).toBe(200);
    expect(restoredListing.data.listing.quantity).toBe(1);
    expect(restoredListing.data.listing.quantitySold).toBe(0);
    expect(restoredListing.data.listing.available).toBe(true);
  });
});

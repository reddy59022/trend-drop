// === STRIPE-ONLY PAYMENT CONFIGURATION ===
// All payments, payouts, and refunds go through Stripe.
// Implements Auth-Only + Capture pattern:
// 1. Authorize payment (capture_method: manual) - no money moves
// 2. After fulfillment (label created), capture the payment
// 3. Only on capture success: update inventory + seller stats

// Don't pin apiVersion - let the SDK use the compatible default
// Initialise Stripe only if a secret key is provided. In environments where
// Stripe is not needed (e.g., during deployment testing), we allow the module to
// load without throwing an error.
let stripe = null;
// Defense-in-depth: never initialize the real Stripe SDK in test mode.
// jest.setup.js deletes STRIPE_SECRET_KEY, but server.js/test-flows may
// inadvertently reintroduce it (e.g. dotenv). Tests must ALWAYS use the
// mock payment-intent registry (global.__mockPaymentIntents) so they never
// hit the live Stripe API.
// Also skip in E2E in-memory mode: the e2eServer uses a placeholder key
// that cannot authenticate againstapi.stripe.com. The mock payment intents
// below handle checkout/confirm/payout flows without real Stripe.
if (process.env.STRIPE_SECRET_KEY && process.env.NODE_ENV !== 'test' && !process.env.E2E_IN_MEMORY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('Stripe disabled (test/E2E mode) — using mock payment intents.');
}

// ALL countries use 8% platform fee. Buyer protection is 5% (separate).
// Commission is calculated on item price ONLY (not shipping or buyer protection fee).
// FIX #5: Max fee increased to $500 to protect revenue on high-value luxury items.
// Previous $150 cap meant $5k items paid only 3% effective rate, $10k items paid 1.5%.
// New $500 cap ensures luxury items ($5k+) still contribute fairly to platform costs.
const countryCommissions = {
  US: { platformFee: 8, buyerProtection: 5, minFee: 0.50, maxFee: 500, currency: 'USD' },
  CA: { platformFee: 8, buyerProtection: 5, minFee: 0.75, maxFee: 650, currency: 'CAD' },
  GB: { platformFee: 8, buyerProtection: 5, minFee: 0.40, maxFee: 400, currency: 'GBP' },
  DE: { platformFee: 8, buyerProtection: 5, minFee: 0.50, maxFee: 450, currency: 'EUR' },
  FR: { platformFee: 8, buyerProtection: 5, minFee: 0.50, maxFee: 450, currency: 'EUR' },
  IT: { platformFee: 8, buyerProtection: 5, minFee: 0.50, maxFee: 450, currency: 'EUR' },
  ES: { platformFee: 8, buyerProtection: 5, minFee: 0.50, maxFee: 450, currency: 'EUR' },
  NL: { platformFee: 8, buyerProtection: 5, minFee: 0.50, maxFee: 450, currency: 'EUR' },
  AU: { platformFee: 8, buyerProtection: 5, minFee: 0.75, maxFee: 750, currency: 'AUD' },
  JP: { platformFee: 8, buyerProtection: 5, minFee: 50, maxFee: 75000, currency: 'JPY' },
  default: { platformFee: 8, buyerProtection: 5, minFee: 0.50, maxFee: 500, currency: 'USD' },
};

const stripeFees = {
  US: { percent: 2.9, fixed: 0.30 },
  CA: { percent: 2.9, fixed: 0.30 },
  GB: { percent: 1.5, fixed: 0.20 },
  EU: { percent: 1.5, fixed: 0.20 },
  AU: { percent: 1.75, fixed: 0.30 },
  JP: { percent: 3.6, fixed: 40 },
  default: { percent: 2.9, fixed: 0.30 },
};

const calculatePaymentBreakdown = (itemPrice, fromCountry, toCountry, weightKg = 0.5, exchangeRate = 1) => {
  const { calculateShipping } = require('./shipping');
  const sellerCommission = countryCommissions[fromCountry] || countryCommissions.default;
  const buyerCommission = countryCommissions[toCountry] || countryCommissions.default;
  const shippingResult = calculateShipping(fromCountry, toCountry, weightKg, itemPrice);
  const shippingCost = shippingResult.cost;
  const platformFeePercent = sellerCommission.platformFee;
  const buyerProtectionPercent = buyerCommission.buyerProtection;
  const platformFee = Math.round(itemPrice * (platformFeePercent / 100) * 100) / 100;
  const buyerProtectionFee = Math.round(itemPrice * (buyerProtectionPercent / 100) * 100) / 100;
  const clampedPlatformFee = Math.max(sellerCommission.minFee, Math.min(platformFee, sellerCommission.maxFee));
  const totalPaid = Math.round((itemPrice + shippingCost + buyerProtectionFee) * 100) / 100;
  const sellerEarnings = Math.round((itemPrice - clampedPlatformFee) * 100) / 100;
  const buyerCountry = ['US', 'CA'].includes(toCountry) ? 'US' :
    ['GB'].includes(toCountry) ? 'GB' :
    ['DE', 'FR', 'IT', 'ES', 'NL'].includes(toCountry) ? 'EU' :
    ['AU'].includes(toCountry) ? 'AU' :
    ['JP'].includes(toCountry) ? 'JP' : 'default';
  const sf = stripeFees[buyerCountry] || stripeFees.default;
  const stripeFee = Math.round((totalPaid * sf.percent / 100 + sf.fixed) * 100) / 100;
  
  // Currency exchange rate locking: store the rate used at calculation time
  const buyerChargeAmount = Math.round(totalPaid * exchangeRate * 100) / 100;
  const sellerSettlementAmount = Math.round(sellerEarnings * exchangeRate * 100) / 100;
  
  return {
    buyer: { itemPrice, shippingCost, buyerProtectionFee, buyerProtectionPercent, totalPaid, buyerChargeAmount, exchangeRate },
    seller: { itemPrice, platformFee: clampedPlatformFee, platformFeePercent, shippingPayout: shippingCost, sellerEarnings, sellerSettlementAmount },
    platform: { commission: clampedPlatformFee, stripeFee, buyerProtectionFee, netRevenue: Math.round((clampedPlatformFee + buyerProtectionFee - stripeFee) * 100) / 100 },
    fromCountry, toCountry,
    sellerCurrency: sellerCommission.currency,
    buyerCurrency: buyerCommission.currency,
    isDomestic: fromCountry === toCountry,
    shipping: shippingResult,
  };
};

// STEP 1: Authorize payment (charge immediately on client confirmation)
// capture_method: 'automatic' means Stripe captures the payment immediately
// Money is charged from customer card, held by Stripe until settlement
// If fulfillment fails (label generation error), we refund immediately
// Helper: generate a deterministic idempotency key for a given payload
const generateIdempotencyKey = (payload) => {
  // Simple deterministic hash – in production you might use a UUID or more robust hash
  const str = JSON.stringify(payload);
  let hash = 0, i, chr;
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return `idemp_${Math.abs(hash)}`;
};

// Fetch the latest exchange rate for a given currency using Stripe's rate API (fallback to 1)
const fetchExchangeRate = async (currency) => {
  if (!stripe) return 1;
  try {
    // Stripe exposes exchange rates via the `rates` endpoint (e.g., stripe.rates.retrieve)
    const rateObj = await stripe.rates.retrieve(currency.toUpperCase());
    return rateObj?.rates?.[currency.toUpperCase()] || 1;
  } catch (e) {
    console.warn('Exchange rate fetch failed, defaulting to 1:', e.message);
    return 1;
  }
};

const authorizePaymentIntent = async (amount, currency, metadata = {}) => {
  const idempotencyKey = generateIdempotencyKey({ amount, currency, metadata });
  if (!stripe) {
    // Test/dev mode: return mock payment intent
    const mockId = `pi_mock_${idempotencyKey.replace('idemp_', '')}`;
    const mockIntent = {
      id: mockId,
      status: 'succeeded',
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      client_secret: 'cs_test_mock',
      metadata,
    };
    // Register in global mock store so retrievePaymentIntent can find it
    if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
    global.__mockPaymentIntents[mockId] = mockIntent;
    return mockIntent;
  }
  return stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: currency.toLowerCase(),
    metadata,
    capture_method: 'manual',
    automatic_payment_methods: { enabled: true },
  }, { idempotencyKey });
};

// STEP 2: Capture the authorized payment (only after fulfillment)
// This moves the money from authorization to captured
const capturePaymentIntent = async (paymentIntentId) => {
  if (!stripe) {
    // Test/dev mode: return mock capture result
    return { id: paymentIntentId, status: 'succeeded' };
  }
  const idempotencyKey = generateIdempotencyKey({ paymentIntentId, action: 'capture' });
  return stripe.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey });
};

// Retrieve a PaymentIntent
const retrievePaymentIntent = async (paymentIntentId) => {
  // Check mock store first (used by tests even when Stripe is initialized)
  if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
  if (global.__mockPaymentIntents[paymentIntentId]) {
    return global.__mockPaymentIntents[paymentIntentId];
  }
  if (!stripe) {
    // Test/dev mode: default to succeeded (simulates automatic capture already done)
    return { id: paymentIntentId, status: 'succeeded', amount: 0 };
  }
  return stripe.paymentIntents.retrieve(paymentIntentId);
};

// Cancel/Release an authorization (if fulfillment fails)
const releaseAuthorization = async (paymentIntentId) => {
  try {
    if (!stripe) return { id: paymentIntentId, status: 'cancelled' };
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'requires_capture') {
      // Auth exists but not captured - cancel it to release the hold
      return stripe.paymentIntents.cancel(paymentIntentId);
    }
    // Already succeeded, canceled, or in another state - nothing to release
    return pi;
  } catch (e) {
    console.error('Release auth error:', e.message);
    throw e;
  }
};

// === STRIPE WEBHOOK SIGNATURE VERIFICATION (fail-closed) ===
// Webhook events are authenticated by the Stripe-Signature header using the
// webhook signing secret (whsec_…) from the Stripe dashboard. Verification is
// ALWAYS enforced unless BOTH of the following hold:
//   1. NODE_ENV is not 'production' (dev/test only), AND
//   2. STRIPE_WEBHOOK_DISABLE_VERIFY=1 is explicitly set in the environment.
// This keeps production fail-closed: a missing or misconfigured signing
// secret can never silently turn the webhook into an unauthenticated event
// sink, and unsigned events are never accepted by default.

const isWebhookSignatureRequired = () => {
  if (process.env.NODE_ENV === 'production') return true;
  return process.env.STRIPE_WEBHOOK_DISABLE_VERIFY !== '1';
};

const getWebhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET || '';

// Verifies a Stripe webhook request. Returns { verified: true, event } on
// success or { verified: false, reason } when the request must be rejected.
// Never throws — callers translate verified:false into an HTTP 400/500.
const verifyStripeWebhookEvent = (stripeClient, payload, signature) => {
  if (!isWebhookSignatureRequired()) {
    // Explicit dev-only bypass: accept the event without a signature check.
    try {
      const event = typeof payload === 'string' || Buffer.isBuffer(payload)
        ? JSON.parse(payload.toString())
        : payload;
      return { verified: true, event, unsigned: true };
    } catch (err) {
      return { verified: false, reason: `Invalid JSON payload: ${err.message}` };
    }
  }

  const secret = getWebhookSecret();
  if (!secret) {
    return {
      verified: false,
      reason: 'Webhook signing secret is not configured (STRIPE_WEBHOOK_SECRET). Refusing to process unsigned webhook events.',
    };
  }
  // An empty or whitespace-only header is NOT a signature — supertest's
  // .set(h, '') and some proxies transmit an empty value; treating it as
  // "present" would forward it to constructEvent, where a lax mock (or a
  // future SDK tolerance) could accept it. Fail closed: 400 missing-header.
  if (!signature || (typeof signature === 'string' && !signature.trim())) {
    return { verified: false, reason: 'Missing Stripe-Signature header' };
  }
  try {
    return {
      verified: true,
      event: stripeClient.webhooks.constructEvent(payload, signature, secret),
    };
  } catch (err) {
    return { verified: false, reason: err.message };
  }
};

// Legacy helper — same throw-on-failure contract as before, now routed
// through the hardened fail-closed logic above.
const verifyStripeWebhook = (payload, signature) => {
  if (!stripe) {
    // In E2E / test mode Stripe is not initialized. Return a harmless
    // mock event so callers (e.g. order lifecycle) can proceed with
    // local state changes without crashing.
    return {
      type: 'mock.events.simulated',
      data: { object: { payment_intent: 'pi_mock_dummy' } },
    };
  }
  const result = verifyStripeWebhookEvent(stripe, payload, signature);
  if (!result.verified) {
    throw new Error(result.reason);
  }
  return result.event;
};

// Issue a refund (for orders that were already captured)
const issueRefund = async (paymentIntentId, amount) => {
  if (!stripe) {
    // E2E / test mode: record refund in mock store and return simulated result.
    if (!global.__mockPaymentIntents) global.__mockPaymentIntents = {};
    if (global.__mockPaymentIntents[paymentIntentId]) {
      global.__mockPaymentIntents[paymentIntentId].status = 'refunded';
    }
    return {
      id: 're_mock_' + Date.now(),
      payment_intent: paymentIntentId,
      amount: amount ? Math.round(amount * 100) : undefined,
      status: 'succeeded',
    };
  }
  const refundParams = { payment_intent: paymentIntentId };
  if (amount) refundParams.amount = Math.round(amount * 100);
  return stripe.refunds.create(refundParams);
};

// Process seller payout – real Stripe Connect if account ID exists, otherwise simulated.
const processSellerPayout = async (sellerId, amount, currency, payoutMethod) => {
  // Look up seller to see if they have a connected Stripe account ID (custom field `stripeAccountId`)
  const User = require('../models/User');
  const seller = await User.findById(sellerId);
  const accountId = seller?.stripeAccountId;
  if (stripe && accountId) {
    const idempotencyKey = generateIdempotencyKey({ sellerId, amount, currency, payoutMethod });
    const payout = await stripe.payouts.create({
      amount: Math.round(amount * 100),
      currency: currency.toLowerCase(),
      method: payoutMethod || 'standard',
    }, {
      stripeAccount: accountId,
      idempotencyKey,
    });
    return {
      id: payout.id,
      amount,
      currency,
      status: payout.status,
      method: payoutMethod || payout.method,
      estimatedArrival: payout.arrival_date ? new Date(payout.arrival_date * 1000) : null,
    };
  }
  // Fallback simulation (MVP)
  return {
    id: `payout_sim_${Date.now()}`,
    amount,
    currency,
    status: 'paid',
    method: payoutMethod || 'stripe',
    estimatedArrival: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
};

module.exports = {
  stripe,
  countryCommissions,
  stripeFees,
  calculatePaymentBreakdown,
  authorizePaymentIntent,
  capturePaymentIntent,
  retrievePaymentIntent,
  releaseAuthorization,
  isWebhookSignatureRequired,
  getWebhookSecret,
  verifyStripeWebhookEvent,
  verifyStripeWebhook,
  processSellerPayout,
  issueRefund,
  generateIdempotencyKey,
  fetchExchangeRate,
};
// === STRIPE-ONLY PAYMENT CONFIGURATION ===
// All payments, payouts, and refunds go through Stripe.
// Implements Auth-Only + Capture pattern:
// 1. Authorize payment (capture_method: manual) - no money moves
// 2. After fulfillment (label created), capture the payment
// 3. Only on capture success: update inventory + seller stats

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-02-24.acacia',
});

const countryCommissions = {
  US: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 50, currency: 'USD' },
  CA: { platformFee: 10, buyerProtection: 5, minFee: 0.75, maxFee: 65, currency: 'CAD' },
  GB: { platformFee: 10, buyerProtection: 5, minFee: 0.40, maxFee: 40, currency: 'GBP' },
  DE: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  FR: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  IT: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  ES: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  NL: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  AU: { platformFee: 10, buyerProtection: 5, minFee: 0.75, maxFee: 60, currency: 'AUD' },
  JP: { platformFee: 12, buyerProtection: 5, minFee: 50, maxFee: 5000, currency: 'JPY' },
  default: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 50, currency: 'USD' },
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

const calculatePaymentBreakdown = (itemPrice, fromCountry, toCountry, weightKg = 0.5) => {
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
  return {
    buyer: { itemPrice, shippingCost, buyerProtectionFee, buyerProtectionPercent, totalPaid },
    seller: { itemPrice, platformFee: clampedPlatformFee, platformFeePercent, shippingPayout: shippingCost, sellerEarnings },
    platform: { commission: clampedPlatformFee, stripeFee, buyerProtectionFee, netRevenue: Math.round((clampedPlatformFee + buyerProtectionFee - stripeFee) * 100) / 100 },
    fromCountry, toCountry,
    sellerCurrency: sellerCommission.currency,
    buyerCurrency: buyerCommission.currency,
    isDomestic: fromCountry === toCountry,
    shipping: shippingResult,
  };
};

// STEP 1: Authorize only (no money charged)
// capture_method: 'manual' means Stripe authorizes the card
// but does NOT capture (charge) the funds
const authorizePaymentIntent = async (amount, currency, metadata = {}) => {
  return stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: currency.toLowerCase(),
    metadata,
    capture_method: 'manual', // <-- AUTH ONLY, NO CAPTURE
    automatic_payment_methods: { enabled: true },
  });
};

// STEP 2: Capture the authorized payment (only after fulfillment)
// This moves the money from authorization to captured
const capturePaymentIntent = async (paymentIntentId) => {
  return stripe.paymentIntents.capture(paymentIntentId);
};

// Retrieve a PaymentIntent
const retrievePaymentIntent = async (paymentIntentId) => {
  return stripe.paymentIntents.retrieve(paymentIntentId);
};

// Cancel/Release an authorization (if fulfillment fails)
const releaseAuthorization = async (paymentIntentId) => {
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (pi.status === 'requires_capture') {
      // Auth exists but not captured - cancel it
      return stripe.paymentIntents.cancel(paymentIntentId);
    }
    if (pi.status === 'succeeded' || pi.status === 'requires_capture') {
      return stripe.paymentIntents.cancel(paymentIntentId);
    }
    return pi;
  } catch (e) {
    console.error('Release auth error:', e.message);
    throw e;
  }
};

// Verify Stripe webhook
const verifyStripeWebhook = (payload, signature) => {
  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
};

// Issue a refund (for orders that were already captured)
const issueRefund = async (paymentIntentId, amount) => {
  const refundParams = { payment_intent: paymentIntentId };
  if (amount) refundParams.amount = Math.round(amount * 100);
  return stripe.refunds.create(refundParams);
};

// Process seller payout (simulated MVP, real Stripe Connect in production)
const processSellerPayout = async (sellerId, amount, currency, payoutMethod) => {
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
  verifyStripeWebhook,
  processSellerPayout,
  issueRefund,
};
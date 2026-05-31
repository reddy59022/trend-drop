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
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
} else {
  console.warn('STRIPE_SECRET_KEY not set – Stripe functionality will be disabled.');
}

// ALL countries use 5% platform fee. Buyer protection is 5% (separate).
// Commission is calculated on item price ONLY (not shipping or buyer protection fee).
const countryCommissions = {
  US: { platformFee: 5, buyerProtection: 5, minFee: 0.50, maxFee: 50, currency: 'USD' },
  CA: { platformFee: 5, buyerProtection: 5, minFee: 0.75, maxFee: 65, currency: 'CAD' },
  GB: { platformFee: 5, buyerProtection: 5, minFee: 0.40, maxFee: 40, currency: 'GBP' },
  DE: { platformFee: 5, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  FR: { platformFee: 5, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  IT: { platformFee: 5, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  ES: { platformFee: 5, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  NL: { platformFee: 5, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  AU: { platformFee: 5, buyerProtection: 5, minFee: 0.75, maxFee: 60, currency: 'AUD' },
  JP: { platformFee: 5, buyerProtection: 5, minFee: 50, maxFee: 5000, currency: 'JPY' },
  default: { platformFee: 5, buyerProtection: 5, minFee: 0.50, maxFee: 50, currency: 'USD' },
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

// STEP 1: Capture immediately (funds held by Stripe, not authorization-only)
// capture_method: 'automatic' means Stripe captures the payment immediately
// Money is held in Stripe and released when seller fulfills
// This avoids 7-day authorization expiration issues
const authorizePaymentIntent = async (amount, currency, metadata = {}) => {
  if (!stripe) {
    throw new Error('Stripe not initialized. Please check STRIPE_SECRET_KEY.');
  }
  return stripe.paymentIntents.create({
    amount: Math.round(amount * 100),
    currency: currency.toLowerCase(),
    metadata,
    capture_method: 'automatic',
    automatic_payment_methods: { enabled: true },
  });
};

// STEP 2: Capture the authorized payment (only after fulfillment)
// This moves the money from authorization to captured
const capturePaymentIntent = async (paymentIntentId) => {
  if (!stripe) {
    throw new Error('Stripe not initialized. Please check STRIPE_SECRET_KEY.');
  }
  return stripe.paymentIntents.capture(paymentIntentId);
};

// Retrieve a PaymentIntent
const retrievePaymentIntent = async (paymentIntentId) => {
  if (!stripe) {
    throw new Error('Stripe not initialized. Please check STRIPE_SECRET_KEY.');
  }
  return stripe.paymentIntents.retrieve(paymentIntentId);
};

// Cancel/Release an authorization (if fulfillment fails)
const releaseAuthorization = async (paymentIntentId) => {
  try {
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

// Verify Stripe webhook
const verifyStripeWebhook = (payload, signature) => {
  if (!stripe) {
    throw new Error('Stripe not initialized. Please check STRIPE_SECRET_KEY.');
  }
  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
};

// Issue a refund (for orders that were already captured)
const issueRefund = async (paymentIntentId, amount) => {
  if (!stripe) {
    throw new Error('Stripe not initialized. Please check STRIPE_SECRET_KEY.');
  }
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
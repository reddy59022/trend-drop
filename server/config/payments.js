// Comprehensive Payment Configuration - Stripe (Web) + RevenueCat (iOS/Android)
// Country-specific commissions, fees, and payout rules

// Platform commission rates by country (percentage)
// Based on local payment processing costs and market rates
const countryCommissions = {
  // North America
  US: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 50, currency: 'USD' },
  CA: { platformFee: 10, buyerProtection: 5, minFee: 0.75, maxFee: 65, currency: 'CAD' },
  MX: { platformFee: 12, buyerProtection: 5, minFee: 10, maxFee: 500, currency: 'MXN' },

  // Europe
  GB: { platformFee: 10, buyerProtection: 5, minFee: 0.40, maxFee: 40, currency: 'GBP' },
  DE: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  FR: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  IT: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  ES: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  NL: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 45, currency: 'EUR' },
  SE: { platformFee: 11, buyerProtection: 5, minFee: 5, maxFee: 500, currency: 'SEK' },
  NO: { platformFee: 11, buyerProtection: 5, minFee: 5, maxFee: 500, currency: 'NOK' },
  PL: { platformFee: 11, buyerProtection: 5, minFee: 2, maxFee: 200, currency: 'PLN' },
  CH: { platformFee: 9, buyerProtection: 4, minFee: 0.50, maxFee: 50, currency: 'CHF' },

  // Asia Pacific
  JP: { platformFee: 12, buyerProtection: 5, minFee: 50, maxFee: 5000, currency: 'JPY' },
  CN: { platformFee: 12, buyerProtection: 5, minFee: 3, maxFee: 300, currency: 'CNY' },
  KR: { platformFee: 12, buyerProtection: 5, minFee: 1000, maxFee: 50000, currency: 'KRW' },
  IN: { platformFee: 12, buyerProtection: 5, minFee: 20, maxFee: 2000, currency: 'INR' },
  SG: { platformFee: 10, buyerProtection: 4, minFee: 0.50, maxFee: 40, currency: 'SGD' },
  AU: { platformFee: 10, buyerProtection: 5, minFee: 0.75, maxFee: 60, currency: 'AUD' },
  NZ: { platformFee: 10, buyerProtection: 5, minFee: 0.75, maxFee: 60, currency: 'NZD' },
  TH: { platformFee: 12, buyerProtection: 5, minFee: 15, maxFee: 1500, currency: 'THB' },
  MY: { platformFee: 12, buyerProtection: 5, minFee: 2, maxFee: 200, currency: 'MYR' },
  ID: { platformFee: 13, buyerProtection: 5, minFee: 5000, maxFee: 500000, currency: 'IDR' },
  PH: { platformFee: 12, buyerProtection: 5, minFee: 15, maxFee: 1500, currency: 'PHP' },
  VN: { platformFee: 13, buyerProtection: 5, minFee: 5000, maxFee: 500000, currency: 'VND' },

  // Middle East
  AE: { platformFee: 10, buyerProtection: 5, minFee: 2, maxFee: 200, currency: 'AED' },
  SA: { platformFee: 11, buyerProtection: 5, minFee: 2, maxFee: 200, currency: 'SAR' },
  IL: { platformFee: 11, buyerProtection: 5, minFee: 2, maxFee: 200, currency: 'ILS' },
  TR: { platformFee: 13, buyerProtection: 5, minFee: 10, maxFee: 1000, currency: 'TRY' },

  // Africa
  ZA: { platformFee: 12, buyerProtection: 5, minFee: 10, maxFee: 1000, currency: 'ZAR' },
  NG: { platformFee: 14, buyerProtection: 5, minFee: 200, maxFee: 50000, currency: 'NGN' },
  EG: { platformFee: 13, buyerProtection: 5, minFee: 10, maxFee: 1000, currency: 'EGP' },
  KE: { platformFee: 13, buyerProtection: 5, minFee: 50, maxFee: 10000, currency: 'KES' },
  GH: { platformFee: 14, buyerProtection: 5, minFee: 5, maxFee: 1000, currency: 'GHS' },

  // South America
  BR: { platformFee: 13, buyerProtection: 5, minFee: 2, maxFee: 250, currency: 'BRL' },
  AR: { platformFee: 14, buyerProtection: 5, minFee: 200, maxFee: 30000, currency: 'ARS' },
  CO: { platformFee: 13, buyerProtection: 5, minFee: 5000, maxFee: 500000, currency: 'COP' },
  CL: { platformFee: 12, buyerProtection: 5, minFee: 300, maxFee: 30000, currency: 'CLP' },
  PE: { platformFee: 13, buyerProtection: 5, minFee: 1.5, maxFee: 150, currency: 'PEN' },

  // Default
  default: { platformFee: 10, buyerProtection: 5, minFee: 0.50, maxFee: 50, currency: 'USD' },
};

// Stripe payment processing fees by country (what Stripe charges us)
const stripeFees = {
  US: { percent: 2.9, fixed: 0.30 },         // 2.9% + $0.30
  CA: { percent: 2.9, fixed: 0.30 },
  GB: { percent: 1.5, fixed: 0.20 },         // 1.5% + £0.20
  EU: { percent: 1.5, fixed: 0.20 },         // 1.5% + €0.20
  AU: { percent: 1.75, fixed: 0.30 },        // 1.75% + A$0.30
  JP: { percent: 3.6, fixed: 40 },           // 3.6% + ¥40
  IN: { percent: 2, fixed: 0 },              // 2% (no fixed)
  SG: { percent: 2.9, fixed: 0.40 },
  default: { percent: 2.9, fixed: 0.30 },
};

// RevenueCat configuration for iOS/Android
const revenueCatConfig = {
  apiKey: process.env.REVENUECAT_API_KEY || '',
  offerings: {
    web: { monthly: 'trenddrop_pro_monthly', yearly: 'trenddrop_pro_yearly' },
    ios: { monthly: 'trenddrop_pro_monthly', yearly: 'trenddrop_pro_yearly' },
    android: { monthly: 'trenddrop_pro_monthly', yearly: 'trenddrop_pro_yearly' },
  },
  entitlements: {
    pro: 'trenddrop_pro',
  },
  // Seller subscription tiers
  sellerTiers: {
    free: { listings: 50, commission: 0, label: 'Free' },
    starter: { listings: 200, commission: 2, monthlyPrice: 4.99, label: 'Starter' },
    pro: { listings: -1, commission: 5, monthlyPrice: 9.99, label: 'Pro' }, // -1 = unlimited
  },
};

// Calculate comprehensive payment breakdown for any country
const calculatePaymentBreakdown = (itemPrice, fromCountry, toCountry, weightKg = 0.5, options = {}) => {
  const { calculateShipping } = require('./shipping');
  const { currencies, convertPrice } = require('./currencies');

  const sellerCommission = countryCommissions[fromCountry] || countryCommissions.default;
  const buyerCommission = countryCommissions[toCountry] || countryCommissions.default;

  // Shipping cost
  const shippingResult = calculateShipping(fromCountry, toCountry, weightKg, itemPrice);
  const shippingCost = shippingResult.cost;

  // Platform fees
  const platformFeePercent = sellerCommission.platformFee;
  const buyerProtectionPercent = buyerCommission.buyerProtection;

  const platformFee = Math.round(itemPrice * (platformFeePercent / 100) * 100) / 100;
  const buyerProtectionFee = Math.round(itemPrice * (buyerProtectionPercent / 100) * 100) / 100;

  // Min/max fee enforcement
  const clampedPlatformFee = Math.max(sellerCommission.minFee, Math.min(platformFee, sellerCommission.maxFee));

  // Buyer total
  const totalPaid = Math.round((itemPrice + shippingCost + buyerProtectionFee) * 100) / 100;

  // Seller earnings
  const sellerEarnings = Math.round((itemPrice - clampedPlatformFee) * 100) / 100;

  // Stripe fee estimate
  const buyerCountry = toCountry === 'US' || toCountry === 'CA' ? 'US' :
    ['GB'].includes(toCountry) ? 'GB' :
    ['DE', 'FR', 'IT', 'ES', 'NL', 'SE', 'NO', 'PL', 'CH'].includes(toCountry) ? 'EU' :
    ['AU'].includes(toCountry) ? 'AU' :
    ['JP'].includes(toCountry) ? 'JP' :
    ['IN'].includes(toCountry) ? 'IN' :
    ['SG'].includes(toCountry) ? 'SG' : 'default';

  const sf = stripeFees[buyerCountry] || stripeFees.default;
  const stripeFee = Math.round((totalPaid * sf.percent / 100 + sf.fixed) * 100) / 100;

  // Payout method fee
  const payoutFeePercent = 1.5; // 1.5% payout processing fee
  const payoutFee = Math.round(sellerEarnings * (payoutFeePercent / 100) * 100) / 100;

  // Net seller earnings after all fees
  const netSellerEarnings = Math.round((sellerEarnings - payoutFee) * 100) / 100;

  return {
    // Buyer breakdown
    buyer: {
      itemPrice,
      shippingCost,
      buyerProtectionFee,
      buyerProtectionPercent,
      totalPaid,
    },
    // Seller breakdown
    seller: {
      itemPrice,
      platformFee: clampedPlatformFee,
      platformFeePercent,
      shippingPayout: shippingCost,
      sellerEarnings,
      payoutFee,
      netSellerEarnings,
    },
    // Platform revenue
    platform: {
      commission: clampedPlatformFee,
      stripeFee,
      buyerProtectionFee,
      payoutFee,
      netRevenue: Math.round((clampedPlatformFee + buyerProtectionFee - stripeFee - payoutFee) * 100) / 100,
    },
    // Metadata
    fromCountry,
    toCountry,
    sellerCurrency: sellerCommission.currency,
    buyerCurrency: buyerCommission.currency,
    isDomestic: fromCountry === toCountry,
    shipping: shippingResult,
  };
};

// Stripe payment intent creation
const createStripePaymentIntent = async (amount, currency, metadata = {}) => {
  // In production: use Stripe SDK
  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  // return stripe.paymentIntents.create({
  //   amount: Math.round(amount * 100), // Stripe uses cents
  //   currency: currency.toLowerCase(),
  //   metadata,
  //   automatic_payment_methods: { enabled: true },
  // });

  // Simulated for development
  return {
    id: `pi_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    client_secret: `pi_${Date.now()}_secret_${Math.random().toString(36).substring(2, 12)}`,
    amount: Math.round(amount * 100),
    currency: currency.toLowerCase(),
    status: 'requires_payment_method',
    metadata,
  };
};

// Stripe webhook verification
const verifyStripeWebhook = (payload, signature) => {
  // In production: use Stripe webhook verification
  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  // return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);

  return { type: 'payment_intent.succeeded', data: { object: { id: 'simulated', metadata: {} } } };
};

// Process seller payout via Stripe Connect
const processSellerPayout = async (sellerId, amount, currency, payoutMethod) => {
  // In production: use Stripe Connect for transfers
  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  // return stripe.transfers.create({
  //   amount: Math.round(amount * 100),
  //   currency: currency.toLowerCase(),
  //   destination: sellerStripeAccountId,
  // });

  return {
    id: `payout_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    amount,
    currency,
    status: 'paid',
    method: payoutMethod,
    estimatedArrival: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  };
};

module.exports = {
  countryCommissions,
  stripeFees,
  revenueCatConfig,
  calculatePaymentBreakdown,
  createStripePaymentIntent,
  verifyStripeWebhook,
  processSellerPayout,
};
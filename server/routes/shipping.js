const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Payout = require('../models/Payout');
const { carriers, calculateShipping, surcharges, trackingStatuses, simulateTrackingUpdate } = require('../config/shipping');
const { currencies, convertPrice, formatPrice } = require('../config/currencies');
const { countries, getCountry } = require('../config/countries');
const Transaction = require('../models/Transaction');
const Return = require('../models/Return');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { calculatePaymentBreakdown } = require('../config/payments');
const { calculateBoostFee } = require('../config/boost');
const { allocatePostage, round2 } = require('../utils/postageFunding');
const { isValidObjectId } = require('../utils/validators');
const {
  createShippingLabel,
  getTracker,
  mapTrackerStatus,
  refundShippingLabel,
  shippingLabelPayload,
  ShippingProviderError,
  isMockMode,
  sandboxSimulationAllowed,
  shippingProviderStatus,
} = require('../services/easypostService');
const { applyOutboundTrackingEvent } = require('../services/shipmentTracking');
const { TERMINAL_STATUSES } = require('../services/shippingPurchase');

// GET /api/shipping/provider - Safe provider readiness for the client.
// The platform owns one EasyPost account; Stripe Connect is only the payout
// rail. Returning the mode makes sandbox/test deployments explicit without
// exposing keys, shipment ids, or connected-account identifiers.
router.get('/provider', (req, res) => {
  res.json(shippingProviderStatus());
});

// GET /api/shipping/carriers - Get all carriers
router.get('/carriers', (req, res) => {
  const { country } = req.query;
  let result = carriers;
  if (country) {
    result = Object.fromEntries(
      Object.entries(carriers).filter(([k, v]) => v.country === country || v.type === 'private')
    );
  }
  res.json(result);
});

// GET /api/shipping/countries - Get all countries
router.get('/countries', (req, res) => {
  res.json(countries);
});

// GET /api/shipping/currencies - Get all currencies
router.get('/currencies', (req, res) => {
  const { country } = req.query;
  if (country) {
    const countryInfo = getCountry(country);
    if (countryInfo) {
      return res.json({ currency: countryInfo.currency, currencies });
    }
  }
  res.json(currencies);
});

// POST /api/shipping/calculate - Calculate shipping cost
router.post('/calculate', (req, res) => {
  try {
    const { fromCountry, toCountry, weightKg, itemPrice, options, buyerCurrency } = req.body;

    if (!fromCountry || !toCountry) {
      return res.status(400).json({ message: 'fromCountry and toCountry are required' });
    }

    // Hostile-input contract (TDD R33): same rule its sibling
    // /calculate-breakdown got in R27. Two ways this used to answer 200 with a
    // price that was simply invented:
    //   * `weightKg || 0.5` only catches FALSY values, so a truthy-but-
    //     unparseable weight ('heavy', 'NaN', {$gt:1}) reached the weight math
    //     and JSON.stringify turned the resulting NaN into `null` — a blank
    //     price the client rendered as if it were real. A negative weight was
    //     silently treated as zero, inventing a cheaper rate.
    //   * a truthy non-string country ({}, 123) passed the gate above and then
    //     failed the zone lookup, which quotes the MOST EXPENSIVE zone — a
    //     US -> US shipment answered with an international DHL rate.
    // Absent values keep their documented defaults (weightKg 0.5, itemPrice 0);
    // present-but-malformed values fail closed with 400.
    const asCountry = (value) =>
      (typeof value === 'string' && value.trim() ? value.trim() : null);
    const sellerCountry = asCountry(fromCountry);
    const buyerCountry = asCountry(toCountry);
    if (!sellerCountry || !buyerCountry) {
      return res.status(400).json({ message: 'fromCountry and toCountry must be country code strings' });
    }

    const numericFields = [
      ['weightKg', weightKg, 0.5, 500],
      ['itemPrice', itemPrice, 0, 1e7],
    ];
    const parsedNumbers = {};
    for (const [field, raw, fallback, max] of numericFields) {
      if (raw === undefined || raw === null) {
        parsedNumbers[field] = fallback;
        continue;
      }
      const asNumber = typeof raw === 'number'
        ? raw
        : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
      if (!Number.isFinite(asNumber) || asNumber < 0 || asNumber > max) {
        return res.status(400).json({ message: `${field} must be a number between 0 and ${max}` });
      }
      parsedNumbers[field] = asNumber;
    }

    const result = calculateShipping(
      sellerCountry,
      buyerCountry,
      parsedNumbers.weightKg,
      parsedNumbers.itemPrice,
      options && typeof options === 'object' && !Array.isArray(options) ? options : {}
    );
    if (req.body.freeShipping === true) {
      result.cost = 0;
      result.freeShipping = true;
      if (result.breakdown) result.breakdown = { ...result.breakdown, total: 0 };
    }

    // Convert to buyer's currency if different
    if (buyerCurrency && buyerCurrency !== 'USD') {
      const curr = currencies[buyerCurrency];
      if (curr) {
        result.costLocal = Math.round(result.cost * curr.rate * 100) / 100;
        result.buyerCurrency = buyerCurrency;
        result.buyerCurrencySymbol = curr.symbol;
        if (result.breakdown) {
          result.breakdownLocal = {
            baseRate: Math.round(result.breakdown.baseRate * curr.rate * 100) / 100,
            weightCharge: Math.round(result.breakdown.weightCharge * curr.rate * 100) / 100,
            surcharges: Math.round(result.breakdown.surcharges * curr.rate * 100) / 100,
            total: Math.round(result.breakdown.total * curr.rate * 100) / 100,
          };
        }
      }
    }

    // Get carrier info
    const carrierCode = result.carrier;
    const carrierInfo = carriers[carrierCode];
    if (carrierInfo) {
      result.carrierName = carrierInfo.name;
      result.carrierServices = carrierInfo.services;
    }

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error calculating shipping' });
  }
});

// POST /api/shipping/calculate-breakdown - Full transparent payment breakdown
router.post('/calculate-breakdown', (req, res) => {
  try {
    const { itemPrice, fromCountry, toCountry, toState, weightKg, currency, platformFeePercent, buyerProtectionPercent } = req.body;

    // Hostile-input contract (TDD R27): every numeric field below feeds money
    // math and is echoed straight back to the client, so a wrong-typed value
    // used to produce NaN — and JSON.stringify serialises NaN as `null`, i.e.
    // a blank price the client renders as if it were fine. A degenerate
    // percent (negative, or 10000%) silently invented a total. Fail closed
    // with 400 rather than answer 200 with unpriceable numbers.
    const numericFields = [
      ['itemPrice', itemPrice, 0, 1e7],
      ['weightKg', weightKg, 0.5, 500],
      ['platformFeePercent', platformFeePercent, 10, 100],
      ['buyerProtectionPercent', buyerProtectionPercent, 5, 100],
    ];
    const parsedNumbers = {};
    for (const [field, raw, fallback, max] of numericFields) {
      if (raw === undefined || raw === null) {
        parsedNumbers[field] = fallback;
        continue;
      }
      const asNumber = typeof raw === 'number'
        ? raw
        : (typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN);
      if (!Number.isFinite(asNumber) || asNumber < 0 || asNumber > max) {
        return res.status(400).json({ message: `${field} must be a number between 0 and ${max}` });
      }
      parsedNumbers[field] = asNumber;
    }

    // Non-string geography/currency values are dropped so downstream config
    // lookups use their documented defaults instead of object keys.
    const asCountry = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
    const sellerCountry = asCountry(fromCountry) || 'US';
    const buyerCountry = asCountry(toCountry) || 'US';
    const state = asCountry(toState);
    const convertTo = typeof currency === 'string' && currency.trim() ? currency.trim() : null;
    const price = parsedNumbers.itemPrice;
    const weightKgSafe = parsedNumbers.weightKg;

    // Calculate shipping. A listing-level free-shipping promise overrides the
    // rate table, exactly as checkout does.
    const freeShipping = req.body.freeShipping === true;
    const shippingResult = calculateShipping(sellerCountry, buyerCountry, weightKgSafe, price);
    const shippingCost = freeShipping ? 0 : shippingResult.cost;

    // Platform fee (paid by seller)
    const feePercent = parsedNumbers.platformFeePercent;
    const platformFee = Math.round(price * (feePercent / 100) * 100) / 100;

    // Buyer protection fee (paid by buyer)
    const bpPercent = parsedNumbers.buyerProtectionPercent;
    const buyerProtectionFee = Math.round(price * (bpPercent / 100) * 100) / 100;

    // Calculate tax (VAT/GST/Sales Tax) based on buyer location
    const { calculateTax } = require('../config/tax');
    const taxResult = calculateTax(buyerCountry, state, price, shippingCost);
    const taxAmount = taxResult.taxAmount;

    // Buyer total (includes tax)
    const totalPaid = Math.round((price + shippingCost + buyerProtectionFee + taxAmount) * 100) / 100;

    // Seller earnings (does NOT include tax - tax is remitted to government)
    // Seller earnings exclude postage: TrendDrop buys the label. Quoting the
    // old shipping pass-through here made the seller dashboard promise money
    // the ledger never credits.
    const sellerEarnings = Math.round((price - platformFee) * 100) / 100;

    // Convert to local currency if needed
    let localBreakdown = null;
    if (convertTo && convertTo !== 'USD') {
      const curr = currencies[convertTo];
      if (curr) {
        localBreakdown = {
          currency: convertTo,
          symbol: curr.symbol,
          itemPrice: Math.round(price * curr.rate * 100) / 100,
          shippingCost: Math.round(shippingCost * curr.rate * 100) / 100,
          buyerProtectionFee: Math.round(buyerProtectionFee * curr.rate * 100) / 100,
          totalPaid: Math.round(totalPaid * curr.rate * 100) / 100,
          platformFee: Math.round(platformFee * curr.rate * 100) / 100,
          sellerEarnings: Math.round(sellerEarnings * curr.rate * 100) / 100,
        };
      }
    }

    res.json({
      // What the buyer pays (USD)
      buyer: {
        itemPrice: price,
        shippingCost,
        buyerProtectionFee,
        buyerProtectionPercent: bpPercent,
        tax: taxResult,
        totalPaid,
      },
      // What the seller receives (USD)
      seller: {
        itemPrice: price,
        platformFee,
        platformFeePercent: feePercent,
        // Postage is a platform service; the seller is paid for the item only.
        shippingPayout: 0,
        sellerEarnings,
      },
      // Shipping details
      shipping: {
        carrier: shippingResult.carrier,
        carrierName: carriers[shippingResult.carrier]?.name || shippingResult.carrier,
        estimatedDays: shippingResult.estimatedDays,
        isDomestic: shippingResult.isDomestic,
        freeShipping,
        zone: shippingResult.zone,
        breakdown: freeShipping ? { ...shippingResult.breakdown, total: 0 } : shippingResult.breakdown,
      },
      // Local currency conversion
      local: localBreakdown,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error calculating breakdown' });
  }
});

// POST /api/shipping/seller-estimate - Seller's own, destination-aware earnings preview.
//
// The listing page used to subtract a hardcoded 8% from the listing price and
// call the result "You'll Earn". That omitted seller-funded postage entirely,
// so a listing could promise $44.16 on a sale that actually credited $42.08.
// This endpoint is the single server-side estimate for that card. It uses the
// same commission and shipping functions as checkout, supports quantity (the
// combined parcel weight changes both the buyer charge and the label), and
// seeds the label estimate from this listing's latest real carrier label when
// one exists. Before a label is bought, a carrier quote is only an estimate;
// the response is explicitly marked as such.
router.post('/seller-estimate', auth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!isValidObjectId(body.listingId)) {
      return res.status(400).json({ message: 'A valid listingId is required' });
    }

    const rawCountry = typeof body.toCountry === 'string' ? body.toCountry.trim().toUpperCase() : '';
    if (!rawCountry || !getCountry(rawCountry)) {
      return res.status(400).json({ message: 'toCountry must be a supported country code' });
    }

    const quantity = body.quantity === undefined ? 1 : Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      return res.status(400).json({ message: 'quantity must be an integer between 1 and 100' });
    }

    const listing = await Listing.findById(body.listingId).lean();
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (String(listing.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the seller can estimate earnings for this listing' });
    }

    const unitPrice = Number(listing.price);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return res.status(422).json({ message: 'Listing price cannot be estimated' });
    }

    const sellerCountry = String(listing.shipsFrom || 'US').toUpperCase();
    const unitWeight = Math.max(0.01, Number(listing.weight) || 0.5);
    const combinedWeight = Math.round(unitWeight * quantity * 1000) / 1000;
    const itemSubtotal = round2(unitPrice * quantity);
    const freeShipping = Boolean(listing.shipping?.freeShipping);

    // Checkout prices one unit and combines the parcel weight, so the preview
    // does exactly the same thing. Platform commission comes from the seller
    // country's configured schedule (not a client-side constant).
    const checkout = calculatePaymentBreakdown(
      unitPrice,
      sellerCountry,
      rawCountry,
      combinedWeight,
      1,
      { freeShipping },
    );
    const platformFee = round2(checkout.seller.platformFee * quantity);
    const boostTier = listing.boost?.active ? (listing.boost.tier || 'standard') : '';
    const boostFee = boostTier
      ? round2(calculateBoostFee(unitPrice, boostTier).fee * quantity)
      : 0;
    const sellerEarningsBeforePostage = round2(itemSubtotal - platformFee - boostFee);

    // calculateShipping() returns 0 when the buyer qualifies for a
    // free-shipping threshold. A carrier label still costs money in that case,
    // so estimate the carrier side from the rate table without the threshold
    // and add the configured insurance percentage ourselves.
    const carrierEstimate = (weight, insuredValue) => round2(
      calculateShipping(sellerCountry, rawCountry, weight, 0).cost
        + Math.max(0, Number(insuredValue) || 0) * surcharges.insuranceRate
    );
    const combinedCarrierQuote = carrierEstimate(combinedWeight, itemSubtotal);
    const singleCarrierQuote = carrierEstimate(unitWeight, unitPrice);

    // A real label for this listing and destination is the best estimate. For
    // extra quantity, add only the carrier's incremental weight/value quote to
    // that real base instead of pretending postage scales linearly.
    const priorLabel = await Transaction.findOne({
      listing: listing._id,
      quantity: 1,
      'shipping.labelCost': { $gt: 0 },
      'shipping.labelRefunded': { $ne: true },
      'shipping.voided': { $ne: true },
      'shipping.weight': unitWeight,
      'shippingAddress.country': new RegExp(`^${rawCountry}$`, 'i'),
      status: {
        $nin: [
          'cancelled', 'cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled',
          'refunded', 'returned', 'chargeback_lost',
        ],
      },
    })
      .sort({ 'shipping.labelCreatedDate': -1, createdAt: -1 })
      .select('shipping.labelCost')
      .lean();

    const listedShippingRate = Math.max(0, Number(listing.shipping?.shippingCost) || 0);
    const historyLabelCost = Number(priorLabel?.shipping?.labelCost) || 0;
    const estimatedLabelCost = historyLabelCost > 0
      ? round2(historyLabelCost + Math.max(0, combinedCarrierQuote - singleCarrierQuote))
      : round2(Math.max(listedShippingRate, combinedCarrierQuote));
    const labelCostSource = historyLabelCost > 0
      ? (quantity === 1 ? 'listing_label_history' : 'listing_label_history_weight_scaled')
      : 'carrier_rate_estimate';

    const postage = allocatePostage({
      labelCost: estimatedLabelCost,
      buyerShipping: checkout.buyer.shippingCost,
      sellerEarnings: sellerEarningsBeforePostage,
    });

    res.json({
      listingId: listing._id,
      quantity,
      fromCountry: sellerCountry,
      toCountry: rawCountry,
      currency: listing.currency || 'USD',
      estimated: true,
      seller: {
        unitPrice,
        itemSubtotal,
        platformFee,
        platformFeePercent: checkout.seller.platformFeePercent,
        boostFee,
        boostTier,
        sellerEarningsBeforePostage,
        shippingPayout: 0,
        sellerPostageSubsidy: postage.sellerSubsidy,
        sellerEarnings: postage.sellerEarningsAfterPostage,
      },
      postage: {
        ...postage,
        source: labelCostSource,
        estimated: true,
        fundable: postage.shortfall === 0,
      },
    });
  } catch (error) {
    console.error('Seller earnings estimate failed:', error);
    res.status(500).json({ message: 'Could not estimate seller earnings' });
  }
});

const labelErrorResponse = (res, error) => {
  const status = error instanceof ShippingProviderError
    ? (error.status === 409 ? 409 : (error.status >= 400 && error.status < 500 ? 422 : 502))
    : 502;
  return res.status(status).json({
    code: error.code || 'SHIPPING_LABEL_FAILED',
    message: error.code === 'EASYPOST_NOT_CONFIGURED'
      ? 'Shipping is temporarily unavailable. Please try again later.'
      : (error.code === 'SHIPPING_ADDRESS_INVALID' ? error.message : 'Shipping label could not be created.'),
    retryable: error.retryable !== false,
  });
};

// Single source of truth for a transaction's platform-purchased label.
// Existing live labels are reused; a missing or voided label is repurchased.
async function ensureTransactionLabel(transaction) {
  // A cancelled/refunded order must never buy postage again. Without this a
  // seller could re-open a closed order from the label screen and make the
  // platform pay for a second label that no sale funds.
  const status = String(transaction.status || '').toLowerCase();
  if (TERMINAL_STATUSES.has(status) || transaction.shipping?.labelRefundPending) {
    throw new ShippingProviderError('This order is closed and cannot purchase another shipping label.', {
      code: 'SHIPPING_ORDER_CLOSED', status: 409, retryable: false,
    });
  }
  // Only a sale that actually holds money may buy platform postage. A pending
  // auction/order has no captured payment, so buying a label there would be a
  // pure platform loss.
  if (!['paid', 'processing', 'shipped'].includes(status)) {
    throw new ShippingProviderError('Shipping labels can only be purchased for a paid order.', {
      code: 'SHIPPING_ORDER_NOT_PAID', status: 409, retryable: false,
    });
  }
  if (transaction.shipping?.trackingNumber && !transaction.shipping?.voided) {
    return transaction.shipping;
  }
  let sellerName = transaction.seller?.name;
  if (!sellerName && transaction.seller) {
    const seller = await User.findById(transaction.seller).select('name');
    sellerName = seller?.name;
  }
  const label = await createShippingLabel({
    // sellerAddress stores the parcel origin, not the display name.
    fromAddress: { ...(transaction.sellerAddress || {}), name: sellerName },
    toAddress: transaction.shippingAddress || {},
    weightKg: transaction.shipping?.weight || 0.5,
    reference: `transaction:${transaction._id}`,
    declaredValue: transaction.itemPrice || 0,
  });
  transaction.shipping = {
    ...transaction.shipping,
    ...shippingLabelPayload(label),
    weight: transaction.shipping?.weight || 0.5,
    voided: false,
    voidedAt: null,
    voidedBy: null,
    labelRefunded: false,
  };
  await transaction.save();
  return label;
}

// POST /api/shipping/label/:transactionId - Create/generate shipping label for transaction
router.post('/label/:transactionId', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }

    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('buyer', 'name email shippingAddress')
      .populate('seller', 'name email shippingAddress')
      .populate('listing', 'title weight');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const sellerId = typeof transaction.seller === 'object' && transaction.seller._id 
      ? transaction.seller._id.toString() : transaction.seller.toString();

    if (sellerId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the seller can generate shipping labels' });
    }

    // Labels are platform-owned and normally already exist by the time a
    // seller opens this endpoint. Reuse it; only a missing/voided label is
    // repurchased.
    const label = await ensureTransactionLabel(transaction);

    // Creating/printing a label is not proof that the carrier accepted the
    // parcel. Keep the paid state until a trusted carrier event advances it.
    const transactionId = req.params.transactionId;
    res.json({
      ...label,
      toAddress: transaction.shippingAddress,
      fromAddress: transaction.sellerAddress,
      labelPdfUrl: `${req.protocol}://${req.get('host')}/api/shipping/label/${transactionId}`,
    });
  } catch (error) {
    console.error('Label creation error:', error.code || error.message);
    return labelErrorResponse(res, error);
  }
});

// POST /api/shipping/void/:transactionId - Void shipping label and refund
router.post('/void/:transactionId', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('seller', 'name balance');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    const sellerId = typeof transaction.seller === 'object' && transaction.seller._id 
      ? transaction.seller._id.toString() : transaction.seller.toString();

    if (sellerId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the seller can void labels' });
    }

    // A label can only be refunded before the parcel is handed to the carrier.
    // Allowing a void after dispatch would let the platform buy a second label
    // for a shipment that was already sent.
    const voidableStatuses = ['pending', 'paid', 'processing'];
    if (!voidableStatuses.includes(transaction.status)) {
      return res.status(400).json({ message: `Cannot void label for ${transaction.status} order` });
    }

    // Cannot void if no label exists
    if (!transaction.shipping?.trackingNumber) {
      return res.status(400).json({ message: 'No label to void' });
    }

    if (transaction.shipping.voided) {
      return res.json({
        voided: true,
        refunded: Boolean(transaction.shipping.labelRefunded),
        refundAmount: transaction.shipping.labelRefunded ? transaction.shipping.labelCost || 0 : 0,
        message: 'Label was already voided; no second refund was requested.',
      });
    }

    // Refund the platform's postage at EasyPost first. If the provider refuses,
    // keep the label live so support can retry instead of silently losing it.
    let providerRefund;
    try {
      providerRefund = await refundShippingLabel(transaction.shipping.shipmentId);
    } catch (error) {
      console.error('EasyPost label refund failed:', error.code || error.message);
      return res.status(502).json({
        code: error.code || 'SHIPPING_REFUND_FAILED',
        message: 'Carrier refund could not be requested. The label is still active.',
      });
    }

    transaction.shipping = {
      ...transaction.shipping,
      voided: true,
      voidedAt: new Date(),
      voidedBy: req.user._id,
      labelRefunded: Boolean(providerRefund.refunded),
    };
    await transaction.save();

    res.json({
      voided: true,
      refunded: Boolean(providerRefund.refunded),
      refundStatus: providerRefund.status,
      refundAmount: providerRefund.refunded ? (transaction.shipping.labelCost || 0) : 0,
      message: providerRefund.refunded
        ? 'Label voided and carrier postage refund requested.'
        : 'Label voided; the carrier did not accept a refund.',
    });
  } catch (error) {
    console.error('Label void error:', error);
    res.status(500).json({ message: 'Error voiding label' });
  }
});

// GET /api/shipping/label/:transactionId - Download shipping label as PDF
router.get('/label/:transactionId', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }

    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('buyer', 'name email shippingAddress')
      .populate('seller', 'name email shippingAddress')
      .populate('listing', 'title weight');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Only the seller can download the shipping label (Issue #4 fix)
    const sellerId = typeof transaction.seller === 'object' && transaction.seller._id 
      ? transaction.seller._id.toString() : transaction.seller.toString();

    if (sellerId !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Only the seller can download shipping labels' });
    }

    if (transaction.shipping?.voided) {
      return res.status(410).json({ message: 'Shipping label has been voided; generate a new label before downloading.' });
    }

    const label = await ensureTransactionLabel(transaction);
    if (!label.labelUrl) {
      return res.status(404).json({ message: 'This label has no printable file.' });
    }
    // EasyPost hosts the purchased label (PDF/PNG). Redirect after auth instead
    // of proxying arbitrary remote content through the API.
    return res.redirect(302, label.labelUrl);
  } catch (error) {
    console.error('Label download error:', error.code || error.message);
    return labelErrorResponse(res, error);
  }
});

// POST /api/shipping/generate-label - Generate shipping label for a transaction
router.post('/generate-label', auth, async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
  // Only the seller can generate shipping labels (Issue #4 fix)
  const sellerId = typeof transaction.seller === 'object' && transaction.seller._id ? transaction.seller._id.toString() : transaction.seller.toString();
  const isSeller = sellerId === req.user._id.toString();
  if (!isSeller) {
    return res.status(403).json({ message: 'Only the seller can generate shipping labels' });
  }

    const label = await ensureTransactionLabel(transaction);

    res.json({
      ...label,
      toAddress: transaction.shippingAddress,
      fromAddress: transaction.sellerAddress,
      labelPdfUrl: `${req.protocol}://${req.get('host')}/api/shipping/label/${transactionId}`,
      downloadUrl: `${req.protocol}://${req.get('host')}/api/shipping/label/${transactionId}`,
      message: 'Shipping label is ready to download.',
    });
  } catch (error) {
    console.error('Generate label error:', error.code || error.message);
    return labelErrorResponse(res, error);
  }
});

// GET /api/shipping/track/:transactionId - Get tracking info (alias)
router.get('/track/:transactionId', auth, async (req, res, next) => {
  req.url = `/tracking/${req.params.transactionId}`;
  next();
});

// GET /api/shipping/tracking/:transactionId - Get tracking info
router.get('/tracking/:transactionId', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('buyer', 'name avatar')
      .populate('seller', 'name avatar')
      .populate('listing', 'title images');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Check if user is buyer or seller
    const userId = req.user._id.toString();
    if (transaction.buyer._id.toString() !== userId && transaction.seller._id.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    res.json({
      trackingNumber: transaction.shipping?.trackingNumber,
      carrier: transaction.shipping?.carrier,
      trackingUrl: transaction.shipping?.trackingUrl,
      status: transaction.status,
      estimatedDelivery: transaction.shipping?.estimatedDelivery,
      actualDelivery: transaction.shipping?.actualDelivery,
      trackingHistory: transaction.shipping?.trackingHistory || [],
      service: transaction.shipping?.service,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error getting tracking info' });
  }
});

// GET /api/shipping/tracking-statuses - Get all possible tracking statuses
router.get('/tracking-statuses', (req, res) => {
  res.json(trackingStatuses);
});

// POST /api/shipping/auto-track - Simulate daily auto-tracking update (admin/cron)
router.post('/auto-track', async (req, res) => {
  try {
    // This endpoint mutates every active shipment. Never leave it publicly
    // triggerable in production; an attacker could advance shipments to
    // delivered and unlock seller payouts/returns without carrier proof.
    const configuredCronSecret = process.env.AUTO_TRACK_SECRET;
    if (process.env.NODE_ENV === 'production' && !configuredCronSecret) {
      console.error('Auto-track disabled: AUTO_TRACK_SECRET is not configured');
      return res.status(503).json({ message: 'Auto-track is not configured' });
    }
    if (process.env.NODE_ENV === 'production' && req.get('x-auto-track-secret') !== configuredCronSecret) {
      return res.status(403).json({ message: 'Invalid auto-track secret' });
    }

    // In production, this is called by a protected cron job daily
    const activeTransactions = await Transaction.find({
      status: { $in: ['shipped', 'in_transit', 'out_for_delivery'] },
      'shipping.trackingNumber': { $ne: '' },
      'autoTracking.enabled': true,
    });

    let updated = 0;
    let skipped = 0;
    let failed = 0;
    const mock = isMockMode();

    for (const txn of activeTransactions) {
      if (txn.status === 'delivered') continue;
      let newStatus = null;
      let detail = {};

      if (mock) {
        // Development/demo only. Production NEVER advances a shipment from a
        // timer: delivery must be proven by the carrier tracker below.
        const labelDate = txn.shipping?.labelCreatedDate || txn.createdAt;
        const daysSince = Math.floor((Date.now() - new Date(labelDate)) / (1000 * 60 * 60 * 24));
        const currentStatus = txn.status === 'shipped' ? 'picked_up' : txn.status;
        newStatus = simulateTrackingUpdate(currentStatus, daysSince);
      } else {
        if (!txn.shipping?.trackerId) { skipped += 1; continue; }
        try {
          const tracker = await getTracker(txn.shipping.trackerId);
          newStatus = mapTrackerStatus(tracker?.status);
          const latest = Array.isArray(tracker?.tracking_details)
            ? tracker.tracking_details[tracker.tracking_details.length - 1]
            : null;
          if (latest) {
            detail = {
              description: latest.message || '',
              timestamp: latest.datetime ? new Date(latest.datetime) : new Date(),
              location: [latest.tracking_location?.city, latest.tracking_location?.state]
                .filter(Boolean).join(', ') || null,
            };
          }
        } catch (providerError) {
          // One unreachable tracker must not block the rest of the batch.
          failed += 1;
          console.error(`Tracker poll failed for ${txn.shipping.trackerId}:`, providerError.code || providerError.message);
          continue;
        }
      }

      if (newStatus) {
        const result = await applyOutboundTrackingEvent(txn, {
          status: newStatus,
          trackingNumber: txn.shipping?.trackingNumber,
          timestamp: detail.timestamp,
          description: detail.description,
          location: detail.location || (mock ? 'Auto-updated' : 'EasyPost'),
        });
        if (result.advanced) updated++;
      }

      // Record the poll itself so operations can see liveness even when the
      // carrier has no new event. The transition service owns the shipment
      // state; this block only records polling telemetry.
      txn.autoTracking.lastChecked = new Date();
      txn.autoTracking.nextCheck = new Date(Date.now() + 24 * 60 * 60 * 1000);
      txn.autoTracking.attempts += 1;
      await txn.save();
    }

    res.json({
      message: `Auto-tracking completed. ${updated} transactions updated.`,
      updated,
      skipped,
      failed,
      source: mock ? 'mock' : 'easypost',
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error running auto-tracking' });
  }
});

// POST /api/shipping/mock-deliver - Development-only carrier simulation.
// Mock labels have no real carrier, so participants need a safe way to move a
// shipment (or return) to delivered to exercise confirm-received, returns,
// escrow release, and payouts. Disabled unless the mock provider is active.
router.post('/mock-deliver', auth, async (req, res) => {
  try {
    if (!isMockMode()) {
      return res.status(404).json({ message: 'Mock delivery is not available' });
    }
    const { transactionId, returnId } = req.body || {};
    const eventTime = new Date();
    const deliveredStep = (description) => ({
      status: 'delivered',
      label: 'Delivered',
      description: description || 'Delivered by test carrier',
      timestamp: eventTime,
      location: 'Test carrier network',
    });

    if (returnId) {
      if (!isValidObjectId(returnId)) return res.status(400).json({ message: 'Invalid returnId' });
      const returnRequest = await Return.findById(returnId);
      if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
      const txn = await Transaction.findById(returnRequest.transaction);
      if (!txn) return res.status(404).json({ message: 'Transaction not found' });
      const userId = String(req.user._id);
      if (![String(txn.buyer), String(txn.seller)].includes(userId)) {
        return res.status(403).json({ message: 'Not authorized' });
      }
      if (['refunded', 'completed'].includes(returnRequest.status)) {
        return res.json({ message: 'Return already settled', status: returnRequest.trackingStatus, returnId });
      }
      returnRequest.trackingHistory = returnRequest.trackingHistory || [];
      returnRequest.trackingHistory.push(deliveredStep('Return package delivered to seller'));
      returnRequest.trackingStatus = 'delivered';
      returnRequest.status = 'delivered';
      returnRequest.deliveredAt = eventTime;
      await returnRequest.save();
      txn.returnDetails = { ...(txn.returnDetails || {}), deliveredAt: eventTime };
      await txn.save();
      return res.json({ message: 'Return marked delivered (test mode)', status: 'delivered', returnId });
    }

    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    const txn = await Transaction.findById(transactionId);
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    const userId = String(req.user._id);
    if (![String(txn.buyer), String(txn.seller)].includes(userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (txn.status === 'delivered') {
      return res.json({ message: 'Already delivered', status: 'delivered', transactionId });
    }
    if (!['shipped', 'in_transit', 'out_for_delivery'].includes(txn.status)) {
      return res.status(400).json({ message: 'Only a shipped package can be delivered' });
    }
    const result = await applyOutboundTrackingEvent(txn, {
      status: 'delivered',
      timestamp: eventTime,
      description: 'Delivered by test carrier',
      location: 'Test carrier network',
    });
    res.json({ message: 'Package marked delivered (test mode)', status: 'delivered', transactionId, ...result });
  } catch (error) {
    console.error('Mock delivery error:', error);
    res.status(500).json({ message: 'Error simulating delivery' });
  }
});

// POST /api/shipping/sandbox/advance - Authenticated sandbox state driver.
//
// The platform-owned EasyPost account is enough for normal fulfillment; this
// route exists only for non-live sandbox deployments (and the deterministic
// mock harness) to exercise every carrier milestone before a real carrier
// scan exists. It is deliberately unavailable in live production.
router.post('/sandbox/advance', auth, async (req, res) => {
  try {
    if (!sandboxSimulationAllowed()) {
      return res.status(404).json({ message: 'Sandbox shipment simulation is not available' });
    }
    const { transactionId, status, trackingNumber, timestamp, location, description } = req.body || {};
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    if (!status) return res.status(400).json({ message: 'status is required' });

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    const userId = String(req.user._id);
    if (![String(transaction.buyer), String(transaction.seller)].includes(userId)) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const result = await applyOutboundTrackingEvent(transaction, {
      status, trackingNumber, timestamp, location, description,
    });
    return res.json({
      message: `Sandbox shipment advanced to '${status}'`,
      sandbox: true,
      ...result,
    });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ message: error.message });
    }
    console.error('Sandbox shipment advance error:', error);
    return res.status(500).json({ message: 'Error advancing sandbox shipment' });
  }
});

// POST /api/shipping/tracking-event - Carrier webhook: advance a shipment.
// Signed with x-tracking-secret (TRACKING_WEBHOOK_SECRET, dev default for
// local/e2e). Idempotent and forward-only: a delivery event can never regress
// an already-delivered order, and duplicate events are recorded harmlessly.
// This closes Bug B3 - before this endpoint there was NO public way to move a
// shipment to 'delivered', so receive/return/dispute flows were unreachable.
router.post('/tracking-event', async (req, res) => {
  try {
    // Never accept a predictable development secret in production. A leaked
    // default would let anyone mark shipments delivered and unlock returns,
    // disputes, and seller payouts.
    const configuredSecret = process.env.TRACKING_WEBHOOK_SECRET;
    // Mock shipping (development/test Stripe only) has no carrier that can call
    // this endpoint, so it may use the deterministic demo secret until a real
    // webhook secret is configured. Live deployments still fail closed.
    if (process.env.NODE_ENV === 'production' && !configuredSecret && !isMockMode()) {
      console.error('Tracking webhook disabled: TRACKING_WEBHOOK_SECRET is not configured');
      return res.status(503).json({ message: 'Tracking webhook is not configured' });
    }
    const secret = configuredSecret || 'trenddrop-tracking-dev';
    if (!req.get('x-tracking-secret') || req.get('x-tracking-secret') !== secret) {
      return res.status(403).json({ message: 'Invalid tracking webhook secret' });
    }
    const { transactionId, returnId, status, trackingNumber, timestamp, location, description } = req.body;
    if ((!transactionId && !returnId) || !status) {
      return res.status(400).json({ message: 'transactionId or returnId and status are required' });
    }

    if (!trackingStatuses.some(s => s.code === status)) {
      return res.status(400).json({ message: `Invalid tracking status: ${status}` });
    }
    const statusOrder = trackingStatuses.filter(s => s.sortOrder >= 0).sort((a, b) => a.sortOrder - b.sortOrder);
    const eventIndex = statusOrder.findIndex(s => s.code === status);

    // Return labels use the same carrier status vocabulary as outbound orders.
    // Persist every missing intermediate step when a carrier sends a jump
    // event (for example, delivered without earlier webhook deliveries), so
    // the buyer and seller see a complete, ordered timeline.
    if (returnId) {
      if (eventIndex === -1) return res.status(400).json({ message: `Invalid return tracking status: ${status}` });
      if (!isValidObjectId(returnId)) return res.status(400).json({ message: 'Invalid returnId' });
      const returnRequest = await Return.findById(returnId);
      if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
      if (returnRequest.status === 'denied') {
        return res.status(400).json({ message: 'Cannot update tracking for denied return' });
      }
      if (['refunded', 'completed'].includes(returnRequest.status)) {
        return res.json({ message: 'Return tracking already settled', status: returnRequest.trackingStatus, returnId: returnRequest._id, alreadySettled: true });
      }
      const txn = await Transaction.findById(returnRequest.transaction);
      if (!txn) return res.status(404).json({ message: 'Transaction not found' });
      const currentIndex = statusOrder.findIndex((s) => s.code === (returnRequest.trackingStatus || 'label_created'));
      const eventTime = timestamp ? new Date(timestamp) : new Date();
      const append = (code) => {
        const meta = trackingStatuses.find((s) => s.code === code);
        returnRequest.trackingHistory.push({
          status: code,
          label: meta?.label || code,
          description: description || meta?.description || '',
          timestamp: eventTime,
          location: location || null,
        });
      };
      returnRequest.trackingHistory = returnRequest.trackingHistory || [];
      if (eventIndex > currentIndex) {
        for (let i = Math.max(0, currentIndex + 1); i <= eventIndex; i += 1) append(statusOrder[i].code);
        returnRequest.trackingStatus = status;
      } else {
        // Duplicate/out-of-order carrier events are retained for audit, but
        // never regress the canonical progress state.
        append(status);
      }
      returnRequest.trackingNumber = trackingNumber || returnRequest.trackingNumber || returnRequest.returnTrackingNumber;
      if (status === 'delivered' && eventIndex >= currentIndex) {
        returnRequest.status = 'delivered';
        returnRequest.deliveredAt = eventTime;
        txn.returnDetails = { ...txn.returnDetails, deliveredAt: eventTime };
      } else if (eventIndex > currentIndex && status === 'out_for_delivery') {
        returnRequest.status = 'out_for_delivery';
      } else if (eventIndex > currentIndex && ['in_transit', 'in_transit_local'].includes(status)) {
        returnRequest.status = 'in_transit';
      }
      await returnRequest.save();
      if (trackingNumber) txn.returnDetails.trackingNumber = trackingNumber;
      await txn.save();
      if (status === 'delivered' && eventIndex >= currentIndex) {
        const { settleDeliveredReturn } = require('../config/cron');
        await settleDeliveredReturn(txn, returnRequest, eventTime.getTime());
      }
      return res.json({ message: `Return tracking event '${status}' recorded`, status, returnId: returnRequest._id, transactionId: txn._id, trackingHistory: returnRequest.trackingHistory });
    }

    if (!isValidObjectId(transactionId)) return res.status(400).json({ message: 'Invalid transactionId' });
    const txn = await Transaction.findById(transactionId);
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });
    const result = await applyOutboundTrackingEvent(txn, {
      status, trackingNumber, timestamp, location, description,
    });
    res.json({ message: `Tracking event '${status}' recorded`, ...result });
  } catch (error) {
    console.error('Tracking event error:', error);
    res.status(500).json({ message: 'Error recording tracking event' });
  }
});

// POST /api/shipping/confirm-received - Buyer confirms receipt
router.post('/confirm-received', auth, async (req, res) => {
  try {
    const { transactionId } = req.body;
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    if (transaction.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Receipt confirmation is only valid after a trusted carrier event has
    // marked the package delivered. Allowing a buyer to confirm a merely
    // shipped order releases the seller before delivery and defeats the
    // escrow/return protections.
    if (!['delivered', 'buyer_confirmed'].includes(transaction.status)) {
      return res.status(400).json({ message: 'Transaction must be delivered before confirming receipt' });
    }

    // Idempotency: confirming twice must not notify twice or risk a second
    // payout. The first confirm already moved the txn to buyer_confirmed.
    if (transaction.status === 'buyer_confirmed' || transaction.buyerConfirmed?.received) {
      return res.status(400).json({ message: 'Receipt already confirmed for this transaction' });
    }

    // NOTE: Use order lifecycle endpoint (/api/orders/:id/confirm-received) instead.
    // This endpoint is kept for backward compatibility but delegates properly.
    transaction.buyerConfirmed.received = true;
    transaction.buyerConfirmed.confirmedAt = new Date();
    transaction.status = 'buyer_confirmed';

    // Notify seller
    const seller = await User.findById(transaction.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: transaction.listing,
        transaction: transaction._id,
        message: 'Buyer confirmed receipt! Payment will be released in 3 days.',
      });
      await seller.save();
    }

    // NOTE: totalSales/totalPurchases and balance changes happen in orderLifecycle auto-complete
    await transaction.save();

    // BUG B4: auto-created payout must use the SAME 8% platform commission
    // as config/payments.js + routes/payouts.js (was hardcoded 10%, which
    // would have overpaid sellers by 2% on any transaction missing a payout).
    try {
      const existingPayout = await Payout.findOne({ transaction: transaction._id });
      if (!existingPayout) {
        // The seller is paid on the item subtotal, not on the buyer's
        // shipping and buyer-protection pass-throughs. The old totalPaid base
        // inflated the pending Payout record by those pass-throughs and made
        // the dashboard report money the seller never earned.
        const salePrice = transaction.paymentBreakdown?.subtotal || transaction.itemPrice || 0;
        const commissionRate = 0.08; // platform commission
        const storedCommission = transaction.paymentBreakdown?.platformFee;
        const commissionAmount = typeof storedCommission === 'number' && Number.isFinite(storedCommission)
          ? storedCommission
          : Math.round(salePrice * commissionRate * 100) / 100;
        const storedEarnings = transaction.paymentBreakdown?.sellerEarnings;
        const payoutAmount = typeof storedEarnings === 'number' && Number.isFinite(storedEarnings)
          ? storedEarnings
          : Math.round((salePrice - commissionAmount) * 100) / 100;
        await Payout.create({
          seller: transaction.seller,
          transaction: transaction._id,
          listing: transaction.listing,
          salePrice,
          commissionRate,
          commissionAmount,
          payoutAmount,
          status: 'pending',
        });
      }
    } catch (payoutErr) {
      console.error('Failed to auto-create payout:', payoutErr.message);
    }

    res.json({
      message: 'Receipt confirmed. Payment released to seller.',
      transaction,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error confirming receipt' });
  }
});

module.exports = router;
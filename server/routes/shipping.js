const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Payout = require('../models/Payout');
const { carriers, calculateShipping, generateLabel, trackingStatuses, simulateTrackingUpdate, getPreferredCarrier, normalizeCarrier } = require('../config/shipping');
const { currencies, convertPrice, formatPrice } = require('../config/currencies');
const { countries, getCountry } = require('../config/countries');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { isValidObjectId } = require('../utils/validators');
const { generateLabelBuffer } = require('../config/labelGenerator');

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

    const result = calculateShipping(fromCountry, toCountry, weightKg || 0.5, itemPrice || 0, options || {});

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

    // Calculate shipping
    const shippingResult = calculateShipping(sellerCountry, buyerCountry, weightKgSafe, price);
    const shippingCost = shippingResult.cost;

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
    const sellerEarnings = Math.round((price - platformFee + shippingCost) * 100) / 100;

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
        shippingPayout: shippingCost,
        sellerEarnings,
      },
      // Shipping details
      shipping: {
        carrier: shippingResult.carrier,
        carrierName: carriers[shippingResult.carrier]?.name || shippingResult.carrier,
        estimatedDays: shippingResult.estimatedDays,
        isDomestic: shippingResult.isDomestic,
        freeShipping: shippingResult.freeShipping,
        zone: shippingResult.zone,
        breakdown: shippingResult.breakdown,
      },
      // Local currency conversion
      local: localBreakdown,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error calculating breakdown' });
  }
});

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

    if (transaction.shipping?.trackingNumber) {
      return res.status(400).json({ message: 'Label already generated for this transaction' });
    }

    const sellerCountry = transaction.sellerAddress?.country || transaction.seller?.shippingAddress?.country || 'US';
    const toCountry = transaction.shippingAddress?.country || 'US';
    const carrierCode = getPreferredCarrier(toCountry, sellerCountry === toCountry);
    const label = generateLabel({
      shippingAddress: transaction.shippingAddress,
      sellerAddress: transaction.sellerAddress,
      weight: transaction.shipping?.weight || 0.5,
    }, carrierCode);

    transaction.shipping = {
      ...transaction.shipping,
      ...label,
      labelCreated: true,
      labelCreatedDate: new Date(),
    };
    // Creating/printing a label is not proof that the carrier accepted the
    // parcel. Keep the paid state until the seller dispatches it through the
    // order lifecycle or a trusted tracking event.
    await transaction.save();

    const transactionId = req.params.transactionId;
    res.json({
      ...label,
      toAddress: transaction.shippingAddress,
      fromAddress: transaction.sellerAddress,
      labelPdfUrl: `${req.protocol}://${req.get('host')}/api/shipping/label/${transactionId}`,
    });
  } catch (error) {
    console.error('Label creation error:', error);
    res.status(500).json({ message: 'Error creating label' });
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

    // Cannot void delivered orders
    const deliveredStatuses = ['delivered', 'completed', 'refunded'];
    if (deliveredStatuses.includes(transaction.status)) {
      return res.status(400).json({ message: `Cannot void label for ${transaction.status} order` });
    }

    // Cannot void if no label exists
    if (!transaction.shipping?.trackingNumber) {
      return res.status(400).json({ message: 'No label to void' });
    }

    // A mock label has no carrier charge and therefore must not be treated as
    // a sale cancellation or a buyer shipping refund. In particular, the
    // transaction's shippingCost is the buyer's checkout charge, not proof
    // that postage was purchased. Real carrier adapters will replace this
    // branch once credentials are configured and will record a provider
    // refund idempotency key before refunding money.
    if (transaction.shipping.voided) {
      return res.json({
        voided: true,
        refunded: false,
        refundAmount: 0,
        message: 'Label was already voided; no financial changes were made.',
      });
    }

    transaction.shipping = {
      ...transaction.shipping,
      voided: true,
      voidedAt: new Date(),
      voidedBy: req.user._id,
    };
    await transaction.save();

    res.json({
      voided: true,
      refunded: false,
      refundAmount: 0,
      message: 'Mock label voided. No carrier postage charge was incurred.',
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

    // If no real label data, generate it
    if (!transaction.shipping?.trackingNumber) {
      const { getPreferredCarrier: gpc } = require('../config/shipping');
      const sellerCountry = transaction.sellerAddress?.country || transaction.seller?.shippingAddress?.country || 'US';
      const toCountry = transaction.shippingAddress?.country || 'US';
      const carrierCode = gpc(toCountry, sellerCountry === toCountry);
      const label = require('../config/shipping').generateLabel({
        shippingAddress: transaction.shippingAddress,
        sellerAddress: transaction.sellerAddress,
        weight: transaction.shipping?.weight || 0.5,
      }, carrierCode);

      transaction.shipping = {
        ...transaction.shipping,
        ...label,
        labelCreated: true,
        labelCreatedDate: new Date(),
      };
      await transaction.save();
    }

    // Build order data for label generation
    const buyer = transaction.buyer || {};
    const seller = transaction.seller || {};
    const fromAddr = transaction.sellerAddress || seller.shippingAddress || {};
    const toAddr = transaction.shippingAddress || {};
    const trackingNum = transaction.shipping?.trackingNumber || '';

    const orderData = {
      transactionId: transaction._id.toString(),
      trackingNumber: trackingNum,
      carrier: transaction.shipping?.carrier || 'USPS',
      carrierService: transaction.shipping?.service || 'Priority Mail',
      trackingUrl: transaction.shipping?.trackingUrl || '',
      fromAddress: {
        name: seller.name || 'Seller',
        fullName: fromAddr.fullName || seller.name || 'Seller',
        street1: fromAddr.street1 || '',
        street2: fromAddr.street2 || '',
        city: fromAddr.city || '',
        state: fromAddr.state || '',
        postalCode: fromAddr.postalCode || '',
        country: fromAddr.country || 'US',
        phone: fromAddr.phone || '',
      },
      toAddress: {
        name: buyer.name || 'Buyer',
        fullName: toAddr.fullName || buyer.name || 'Buyer',
        street1: toAddr.street1 || '',
        street2: toAddr.street2 || '',
        city: toAddr.city || '',
        state: toAddr.state || '',
        postalCode: toAddr.postalCode || '',
        country: toAddr.country || 'US',
        phone: toAddr.phone || '',
      },
      weight: transaction.shipping?.weight || 0.5,
      service: transaction.shipping?.service || 'Priority Mail',
    };

    // Generate PDF label
    const pdfBuffer = await generateLabelBuffer(orderData);

    // Send PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="trenddrop-label-${trackingNum}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Label download error:', error);
    res.status(500).json({ message: 'Error generating label PDF' });
  }
});

// POST /api/shipping/generate-label - Generate shipping label for a transaction
router.post('/generate-label', auth, async (req, res) => {
  try {
    const { transactionId, carrier } = req.body;
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    const requestedCarrier = carrier === undefined ? undefined : normalizeCarrier(carrier);
    if (carrier !== undefined && !requestedCarrier) {
      return res.status(400).json({ message: 'Unsupported carrier' });
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

    const sellerCountry = transaction.sellerAddress?.country || 'US';
    const buyerCountry = transaction.shippingAddress?.country || 'US';
    const carrierCode = requestedCarrier || getPreferredCarrier(buyerCountry, sellerCountry === buyerCountry);

    if (transaction.shipping?.trackingNumber) {
      return res.json({
        trackingNumber: transaction.shipping.trackingNumber,
        carrier: transaction.shipping.carrier,
        trackingUrl: transaction.shipping.trackingUrl,
        service: transaction.shipping.service,
        labelPdfUrl: `${req.protocol}://${req.get('host')}/api/shipping/label/${transactionId}`,
        message: 'Shipping label already generated',
      });
    }

    const label = generateLabel({
      shippingAddress: transaction.shippingAddress,
      sellerAddress: transaction.sellerAddress,
      weight: transaction.shipping?.weight || 0.5,
    }, carrierCode);

    // Update transaction with label info
    transaction.shipping = {
      ...transaction.shipping,
      carrier: label.carrier,
      trackingNumber: label.trackingNumber,
      trackingUrl: label.trackingUrl,
      labelCreated: true,
      labelCreatedDate: new Date(),
      estimatedDelivery: new Date(label.estimatedDelivery),
      service: label.service,
      trackingHistory: label.statusHistory,
    };
    // Label creation is not dispatch confirmation. Keep the transaction paid
    // until the seller ships it or a trusted carrier event advances it.
    await transaction.save();

    // Generate label URL for response
    const labelUrl = `${req.protocol}://${req.get('host')}/api/shipping/label/${transactionId}`;

    res.json({
      ...label,
      labelPdfUrl: labelUrl,
      message: 'Shipping label generated. Download from:', 
      downloadUrl: labelUrl,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error generating label' });
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
    // In production, this would be called by a cron job daily
    const activeTransactions = await Transaction.find({
      status: { $in: ['shipped', 'in_transit', 'out_for_delivery'] },
      'shipping.trackingNumber': { $ne: '' },
      'autoTracking.enabled': true,
    });

    let updated = 0;
    for (const txn of activeTransactions) {
      const labelDate = txn.shipping?.labelCreatedDate || txn.createdAt;
      const daysSince = Math.floor((Date.now() - new Date(labelDate)) / (1000 * 60 * 60 * 24));
      const currentStatus = txn.status === 'shipped' ? 'picked_up' : txn.status;
      const newStatus = simulateTrackingUpdate(currentStatus, daysSince);

      if (newStatus !== currentStatus) {
        txn.status = newStatus === 'delivered' ? 'delivered' : newStatus;
        if (newStatus === 'delivered') {
          txn.shipping.actualDelivery = new Date();
          // Bug B5: the old code called deliveryDate.setDate(...) which is not
          // a JS Date method and would throw here. Schedule the next auto-check
          // (the buyer-confirmation window is enforced by /api/orders/auto-process).
          txn.autoTracking.nextCheck = new Date(Date.now() + 24 * 60 * 60 * 1000);
        }
        txn.shipping.trackingHistory.push({
          status: newStatus,
          label: trackingStatuses.find(s => s.code === newStatus)?.label || newStatus,
          description: trackingStatuses.find(s => s.code === newStatus)?.description || '',
          timestamp: new Date(),
          location: 'Auto-updated',
        });
        txn.autoTracking.lastChecked = new Date();
        txn.autoTracking.nextCheck = new Date(Date.now() + 24 * 60 * 60 * 1000);
        txn.autoTracking.attempts += 1;
        await txn.save();
        updated++;
      }
    }

    res.json({ message: `Auto-tracking completed. ${updated} transactions updated.`, updated });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error running auto-tracking' });
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
    const secret = process.env.TRACKING_WEBHOOK_SECRET || 'trenddrop-tracking-dev';
    if (!req.get('x-tracking-secret') || req.get('x-tracking-secret') !== secret) {
      return res.status(403).json({ message: 'Invalid tracking webhook secret' });
    }
    const { transactionId, status, trackingNumber, timestamp, location, description } = req.body;
    if (!transactionId || !status || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'transactionId and status are required' });
    }
    const txn = await Transaction.findById(transactionId);
    if (!txn) return res.status(404).json({ message: 'Transaction not found' });

    const statusOrder = trackingStatuses.filter(s => s.sortOrder >= 0).sort((a, b) => a.sortOrder - b.sortOrder);
    const eventIndex = statusOrder.findIndex(s => s.code === status);
    if (eventIndex === -1) {
      return res.status(400).json({ message: `Invalid tracking status: ${status}` });
    }

    // Current tracking position (label_created is the pre-dispatch position).
    const currentTracking = txn.status === 'shipped' ? 'picked_up' : txn.status;
    const currentIndex = statusOrder.findIndex(s => s.code === currentTracking);

    // Append the event to history (carriers legitimately post duplicate events).
    txn.shipping.trackingHistory = txn.shipping.trackingHistory || [];
    txn.shipping.trackingHistory.push({
      status,
      label: trackingStatuses.find(s => s.code === status)?.label || status,
      description: description || trackingStatuses.find(s => s.code === status)?.description || '',
      timestamp: timestamp ? new Date(timestamp) : new Date(),
      location: location || null,
    });
    txn.shipping.trackingHistory = txn.shipping.trackingHistory.slice(-50);

    // Advance the transaction status only when the event moves it forward.
    if (currentIndex === -1 || eventIndex >= currentIndex) {
      if (status === 'delivered') {
        txn.status = 'delivered';
        txn.shipping.actualDelivery = timestamp ? new Date(timestamp) : new Date();
      } else if (txn.status !== 'delivered' && ['in_transit', 'in_transit_local', 'out_for_delivery'].includes(status)) {
        txn.status = status;
      }
      if (trackingNumber) txn.shipping.trackingNumber = trackingNumber;
    }

    await txn.save();
    res.json({ message: `Tracking event '${status}' recorded`, status, transactionId: txn._id });
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
        const salePrice = transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || 0;
        const commissionRate = 0.08; // platform commission
        const commissionAmount = Math.round(salePrice * commissionRate * 100) / 100;
        const payoutAmount = Math.round((salePrice - commissionAmount) * 100) / 100;
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
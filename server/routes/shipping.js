const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Payout = require('../models/Payout');
const { carriers, calculateShipping, generateLabel, trackingStatuses, simulateTrackingUpdate, getPreferredCarrier } = require('../config/shipping');
const { currencies, convertPrice, formatPrice } = require('../config/currencies');
const { countries, getCountry } = require('../config/countries');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
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
    const { itemPrice, fromCountry, toCountry, weightKg, currency, platformFeePercent, buyerProtectionPercent } = req.body;

    const sellerCountry = fromCountry || 'US';
    const buyerCountry = toCountry || 'US';
    const price = itemPrice || 0;

    // Calculate shipping
    const shippingResult = calculateShipping(sellerCountry, buyerCountry, weightKg || 0.5, price);
    const shippingCost = shippingResult.cost;

    // Platform fee (paid by seller)
    const feePercent = platformFeePercent || 10;
    const platformFee = Math.round(price * (feePercent / 100) * 100) / 100;

    // Buyer protection fee (paid by buyer)
    const bpPercent = buyerProtectionPercent || 5;
    const buyerProtectionFee = Math.round(price * (bpPercent / 100) * 100) / 100;

    // Buyer total
    const totalPaid = Math.round((price + shippingCost + buyerProtectionFee) * 100) / 100;

    // Seller earnings
    const sellerEarnings = Math.round((price - platformFee + shippingCost) * 100) / 100;

    // Convert to local currency if needed
    let localBreakdown = null;
    if (currency && currency !== 'USD') {
      const curr = currencies[currency];
      if (curr) {
        localBreakdown = {
          currency,
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

// GET /api/shipping/label/:transactionId - Download shipping label as PDF
router.get('/label/:transactionId', auth, async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('buyer', 'name email shippingAddress')
      .populate('seller', 'name email shippingAddress')
      .populate('listing', 'title weight');

    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }

    // Check authorization (seller or buyer)
    const isAuthorized = 
      (typeof transaction.buyer === 'object' ? transaction.buyer._id.toString() : transaction.buyer.toString()) === req.user._id.toString() ||
      (typeof transaction.seller === 'object' ? transaction.seller._id.toString() : transaction.seller.toString()) === req.user._id.toString();

    if (!isAuthorized) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // If no real label data, generate it
    if (!transaction.shipping?.trackingNumber) {
      const { getPreferredCarrier: gpc } = require('../config/shipping');
      const sellerCountry = transaction.shippingAddress?.country || 'US';
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

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
  // Allow the seller or the buyer who owns the transaction to generate the label.
  // Determine if the requesting user is the seller or buyer for this transaction.
  // `transaction.seller` and `transaction.buyer` may be either ObjectId strings or populated documents.
  // When populated, they are objects containing an `_id` field. We normalize both cases to compare IDs.
  const sellerId = typeof transaction.seller === 'object' && transaction.seller._id ? transaction.seller._id.toString() : transaction.seller.toString();
  const buyerId = typeof transaction.buyer === 'object' && transaction.buyer._id ? transaction.buyer._id.toString() : transaction.buyer?.toString();

  const isSeller = sellerId === req.user._id.toString();
  const isBuyer = buyerId && buyerId === req.user._id.toString();
  if (!isSeller && !isBuyer) {
    return res.status(403).json({ message: 'Not authorized' });
  }

    const carrierCode = carrier || getPreferredCarrier(
      transaction.shippingAddress?.country || 'US',
      true
    );

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
    transaction.status = 'shipped';
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

// GET /api/shipping/tracking/:transactionId - Get tracking info
router.get('/tracking/:transactionId', auth, async (req, res) => {
  try {
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
          // Auto-complete after 3 days of delivery
          const deliveryDate = new Date();
          deliveryDate.setDate(deliveryDate.getDate() + 3);
          txn.autoTracking.nextCheck = deliveryDate;
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

// POST /api/shipping/confirm-received - Buyer confirms receipt
router.post('/confirm-received', auth, async (req, res) => {
  try {
    const { transactionId } = req.body;

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found' });
    }
    if (transaction.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    transaction.buyerConfirmed.received = true;
    transaction.buyerConfirmed.confirmedAt = new Date();
    transaction.status = 'completed';

    // Release funds to seller
    const seller = await User.findById(transaction.seller);
    if (seller) {
      seller.balance.available += transaction.paymentBreakdown.sellerEarnings;
      seller.balance.pending -= transaction.paymentBreakdown.sellerEarnings;
      seller.stats.totalSales = (seller.stats.totalSales || 0) + 1;
      await seller.save();
    }

    // Update buyer stats
    const buyer = await User.findById(transaction.buyer);
    if (buyer) {
      buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
      await buyer.save();
    }

    await transaction.save();

    // BUG 5: Auto-create Payout record on completion
    try {
      const existingPayout = await Payout.findOne({ transaction: transaction._id });
      if (!existingPayout) {
        const salePrice = transaction.paymentBreakdown?.totalPaid || transaction.itemPrice || 0;
        const commissionAmount = Math.round(salePrice * 0.10 * 100) / 100;
        const payoutAmount = Math.round((salePrice - commissionAmount) * 100) / 100;
        await Payout.create({
          seller: transaction.seller,
          transaction: transaction._id,
          listing: transaction.listing,
          salePrice,
          commissionRate: 0.10,
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
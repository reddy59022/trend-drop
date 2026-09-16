const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const Return = require('../models/Return');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Listing = require('../models/Listing');
const { orderStates, isValidTransition } = require('../config/orderLifecycle');
const { isValidObjectId } = require('../utils/validators');
const { reverseBoostFeeOwed, markPayoutRefunded, syncOrderFromTransaction } = require('./orderLifecycle');

// Reuse the listing image pipeline (Cloudinary in prod, deterministic mock in test).
const { uploadListingImages } = (() => {
  const mod = require('./listings');
  return { uploadListingImages: mod.uploadListingImages || (async (files) => (files || []).map((f) => `test://return-image/${Date.now()}-${f.originalname}`)) };
})();

// POST /api/returns - Create a return request (buyer only).
// Accepts BOTH JSON (images = array of URLs) and multipart/form-data with
// image files (field name: images). ENTERPRISE STANDARD: 1-5 photos required
// so support/seller can review the item condition BEFORE approval.
router.post('/', auth, (req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    upload.array('images', 5)(req, res, (err) => {
      if (err) return res.status(400).json({ message: `Image upload failed: ${err.message}` });
      next();
    });
  } else {
    next();
  }
}, async (req, res) => {
  try {
    let { transactionId, reason, description, images } = req.body;
    // Multipart: files land in req.files; merge with any JSON-string images.
    if (req.files && req.files.length) {
      const uploadedUrls = await uploadListingImages(req.files);
      images = uploadedUrls;
    } else if (typeof images === 'string' && images.trim().startsWith('[')) {
      try { images = JSON.parse(images); } catch { images = []; }
    }
    if (!transactionId || !isValidObjectId(transactionId)) {
      return res.status(400).json({ message: 'Invalid transactionId' });
    }
    const transaction = await Transaction.findById(transactionId);
    if (!transaction) return res.status(404).json({ message: 'Transaction not found' });
    if (transaction.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const existing = await Return.findOne({ transaction: transactionId });
    if (existing) return res.status(400).json({ message: 'Return already exists for this transaction' });
    if (!['completed', 'delivered'].includes(transaction.status)) {
      return res.status(400).json({ message: 'Transaction must be completed before returning' });
    }
    if (!isValidTransition(transaction.status, orderStates.RETURN_REQUESTED)) {
      return res.status(400).json({ message: 'Cannot request return from current order status' });
    }

    // ============================================================
    // BUSINESS RULES: "Return window: 3 days after delivery
    // confirmation". /eligible and the batch endpoint already enforce
    // this — the single-item POST must too, or buyers can return items
    // delivered long after the window closed.
    // ============================================================
    const RETURN_WINDOW_DAYS = 3;
    const deliveredAt = transaction.shipping?.actualDelivery
      || transaction.buyerConfirmed?.confirmedAt
      || null;
    if (deliveredAt && new Date(new Date(deliveredAt).getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000) < new Date()) {
      return res.status(400).json({
        message: `Return window closed (${RETURN_WINDOW_DAYS} days after delivery)`,
      });
    }

    // ============================================================
    // BUSINESS RULES: "Return shipping cost responsibility varies by
    // reason (buyer/seller)".
    //   seller → seller-fault reasons: the buyer is refunded the FULL
    //            totalPaid (item + outbound shipping + protection).
    //   buyer  → buyer-remorse reasons ("Changed mind"): the buyer is
    //            refunded the item price ONLY; outbound shipping and
    //            protection stay with the buyer, who also pays return
    //            shipping. Unknown reasons default to 'seller' so we
    //            never shortchange a buyer on an ambiguous claim.
    // ============================================================
    const BUYER_RESPONSIBILITY_REASONS = ['Changed mind'];
    const returnShippingResponsibility = BUYER_RESPONSIBILITY_REASONS.includes(reason) ? 'buyer' : 'seller';
    const totalPaid = transaction.paymentBreakdown?.totalPaid || 0;
    const itemPrice = transaction.itemPrice || transaction.paymentBreakdown?.subtotal || 0;
    const refundAmount = returnShippingResponsibility === 'buyer'
      ? itemPrice
      : (totalPaid || itemPrice);
    // ENTERPRISE STANDARD: buyer must attach 1-5 photos so support/seller can
    // review the item condition BEFORE approval. Fewer than 1 or more than 5
    // is rejected outright.
    const rawImgs = Array.isArray(images) ? images.filter((u) => typeof u === 'string' && u.trim()) : [];
    if (rawImgs.length < 1 || rawImgs.length > 5) {
      return res.status(400).json({ message: 'Please attach 1 to 5 photos of the item with your return request' });
    }
    const imgs = rawImgs.slice(0, 5);
    const returnRequest = await Return.create({
      transaction: transactionId, buyer: req.user._id, seller: transaction.seller,
      listing: transaction.listing, reason, description: description || '', refundAmount,
      returnShippingResponsibility,
      images: imgs,
    });
    // Sync to Transaction lifecycle
    transaction.status = orderStates.RETURN_REQUESTED;
    transaction.returnDetails = {
      ...transaction.returnDetails, reason, description: description || '',
      requestedAt: new Date(), returnId: returnRequest._id,
    };
    await transaction.save();
    try {
      const seller = await User.findById(transaction.seller);
      if (seller) {
        seller.notifications.push({ type: 'sale', from: req.user._id, listing: transaction.listing, message: `Return requested: ${reason}`, read: false });
        await seller.save();
      }
    } catch (e) { console.error('Notify seller return request:', e.message); }
    res.status(201).json(returnRequest);
  } catch (error) {
    console.error('Create return error:', error);
    res.status(500).json({ message: 'Failed to create return request' });
  }
});

// GET /api/returns/eligible - Transactions eligible for a return request.
// ENTERPRISE STANDARD eligibility rules:
//   1. Buyer owns the transaction
//   2. Status is delivered/completed (the item physically arrived)
//   3. Still inside the return window (delivered + RETURN_WINDOW_DAYS)
//   4. No return request already exists for the transaction
router.get('/eligible', auth, async (req, res) => {
  try {
    const RETURN_WINDOW_DAYS = 3;
    const cutoff = new Date(Date.now() - RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const txns = await Transaction.find({
      buyer: req.user._id,
      status: { $in: ['delivered', 'completed', 'buyer_confirmed'] },
    })
      .populate('listing', 'title images price')
      .populate('seller', 'name')
      .sort({ createdAt: -1 })
      .lean();

    const existingReturns = await Return.find({ buyer: req.user._id }).select('transaction status').lean();
    const returnedTxnIds = new Set(existingReturns.map((r) => String(r.transaction)));

    // Delivery date: prefer actualDelivery, fall back to buyerConfirmed.at or
    // updatedAt. A transaction delivered before the cutoff is OUT of window.
    const eligible = [];
    const ineligible = [];
    for (const t of txns) {
      if (returnedTxnIds.has(String(t._id))) {
        ineligible.push({ transactionId: t._id, title: t.listing?.title || 'Item', reason: 'Return already requested' });
        continue;
      }
      const deliveredAt = t.shipping?.actualDelivery || t.buyerConfirmed?.confirmedAt || t.updatedAt || t.createdAt;
      if (deliveredAt && new Date(deliveredAt) < cutoff) {
        ineligible.push({ transactionId: t._id, title: t.listing?.title || 'Item', reason: `Return window closed (${RETURN_WINDOW_DAYS} days after delivery)` });
        continue;
      }
      eligible.push({
        transactionId: t._id,
        title: t.listing?.title || 'Item',
        image: t.listing?.images?.[0] || null,
        price: t.itemPrice,
        currency: t.currency || 'USD',
        seller: t.seller?.name || '',
        status: t.status,
        deliveredAt,
        returnWindowEnds: deliveredAt ? new Date(new Date(deliveredAt).getTime() + RETURN_WINDOW_DAYS * 24 * 60 * 60 * 1000) : null,
        daysRemaining: deliveredAt ? Math.max(0, RETURN_WINDOW_DAYS - Math.floor((Date.now() - new Date(deliveredAt).getTime()) / (24 * 60 * 60 * 1000))) : RETURN_WINDOW_DAYS,
      });
    }
    res.json({ eligible, ineligible, returnWindowDays: RETURN_WINDOW_DAYS });
  } catch (error) {
    console.error('Get eligible returns error:', error);
    res.status(500).json({ message: 'Failed to fetch eligible returns' });
  }
});

// GET /api/returns - Get returns for current user (buyer or seller)
// PRIVACY: the generated return label URL is visible ONLY to the buyer.
// The return tracking number is visible to BOTH buyer and seller so the
// seller can track the inbound shipment.
router.get('/', auth, async (req, res) => {
  try {
    const returns = await Return.find({ $or: [{ buyer: req.user._id }, { seller: req.user._id }] })
      .populate('listing', 'title images price').populate('buyer', 'name avatar')
      .populate('seller', 'name avatar').sort({ createdAt: -1 });
    const isBuyerOf = (r) => String(r.buyer?._id || r.buyer) === String(req.user._id);
    res.json(returns.map((r) => {
      const obj = r.toObject ? r.toObject() : r;
      if (!isBuyerOf(obj)) {
        // Seller view: hide the label URL, keep the tracking number.
        obj.returnLabel = undefined;
      }
      return obj;
    }));
  } catch (error) {
    console.error('Get returns error:', error);
    res.status(500).json({ message: 'Failed to fetch returns' });
  }
});

// GET /api/returns/:id - Get single return details
// PRIVACY: the return label URL is visible ONLY to the buyer; the tracking
// number is visible to both buyer and seller.
router.get('/:id', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id)
      .populate('listing', 'title images price').populate('buyer', 'name avatar').populate('seller', 'name avatar');
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    const userId = req.user._id.toString();
    if (returnRequest.buyer._id.toString() !== userId && returnRequest.seller._id.toString() !== userId) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    const obj = returnRequest.toObject ? returnRequest.toObject() : returnRequest;
    if (returnRequest.buyer._id.toString() !== userId) {
      obj.returnLabel = undefined; // seller must not see the buyer's label URL
    }
    res.json(obj);
  } catch (error) {
    console.error('Get return error:', error);
    res.status(500).json({ message: 'Failed to fetch return' });
  }
});

// PUT /api/returns/:id/approve - Seller approves return request
router.put('/:id/approve', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Return is not in pending status' });
    }
    returnRequest.status = 'approved';
    // ENTERPRISE STANDARD: generate a return shipping label the moment the
    // seller approves. The label (URL + return tracking number) is stored on
    // the return record; the URL is visible only to the buyer, the tracking
    // number is visible to BOTH buyer and seller for inbound tracking.
    let label;
    try {
      const { generateReturnLabel } = require('../services/returnLabelService');
      label = await generateReturnLabel(returnRequest);
      returnRequest.returnLabel = label.labelUrl || '';
      returnRequest.returnTrackingNumber = label.trackingNumber || '';
      returnRequest.labelCarrier = label.label || '';
      returnRequest.labelCost = label.cost || 0;
      returnRequest.labelGeneratedAt = new Date();
      await returnRequest.save();
    } catch (labelErr) {
      console.error('Return label generation failed (approval continues):', labelErr.message);
    }
    await returnRequest.save();
    // Sync to Transaction lifecycle
    const txn = await Transaction.findById(returnRequest.transaction);
    if (txn && isValidTransition(txn.status, orderStates.RETURN_ACCEPTED)) {
      txn.status = orderStates.RETURN_ACCEPTED;
      txn.returnDetails = { ...txn.returnDetails, approvedAt: new Date() };
      await txn.save();
    }
    try {
      const buyer = await User.findById(returnRequest.buyer);
      if (buyer) {
        const labelMsg = returnRequest.returnTrackingNumber
          ? ` Your prepaid return label is ready in the Returns Center — tracking number ${returnRequest.returnTrackingNumber}.`
          : '';
        buyer.notifications.push({ type: 'sale', from: req.user._id, listing: returnRequest.listing, message: `Your return request has been approved.${labelMsg} Please ship the item back.`, read: false });
        await buyer.save();
      }
    } catch (e) { console.error('Notify buyer approve:', e.message); }
    // PRIVACY: the seller triggered the approval, so strip the buyer-only
    // label URL from the seller's response (tracking number stays visible).
    const approvedObj = returnRequest.toObject ? returnRequest.toObject() : returnRequest;
    approvedObj.returnLabel = undefined;
    res.json(approvedObj);
  } catch (error) {
    console.error('Approve return error:', error);
    res.status(500).json({ message: 'Failed to approve return' });
  }
});

// PUT /api/returns/:id/deny - Seller denies return request
router.put('/:id/deny', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'pending') {
      return res.status(400).json({ message: 'Return is not in pending status' });
    }
    returnRequest.status = 'denied';
    returnRequest.denialReason = req.body.reason || 'Return denied by seller';
    await returnRequest.save();
    // Sync to Transaction lifecycle
    const txn = await Transaction.findById(returnRequest.transaction);
    if (txn && isValidTransition(txn.status, orderStates.RETURN_REJECTED)) {
      txn.status = orderStates.RETURN_REJECTED;
      txn.returnDetails = { ...txn.returnDetails, rejectedAt: new Date(), rejectionReason: returnRequest.denialReason };
      await txn.save();
      try { await syncOrderFromTransaction(txn, orderStates.RETURN_REJECTED); } catch {}
    }
    try {
      const buyer = await User.findById(returnRequest.buyer);
      if (buyer) {
        buyer.notifications.push({ type: 'sale', from: req.user._id, listing: returnRequest.listing, message: `Your return request has been denied: ${returnRequest.denialReason}`, read: false });
        await buyer.save();
      }
    } catch (e) { console.error('Notify buyer deny:', e.message); }
    res.json(returnRequest);
  } catch (error) {
    console.error('Deny return error:', error);
    res.status(500).json({ message: 'Failed to deny return' });
  }
});

// PUT /api/returns/:id/ship - Buyer ships return item back
router.put('/:id/ship', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.buyer.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'approved') {
      return res.status(400).json({ message: 'Return must be approved before shipping' });
    }
    returnRequest.status = 'shipped';
    returnRequest.trackingNumber = req.body.trackingNumber || '';
    await returnRequest.save();
    // Sync to Transaction lifecycle
    const txn = await Transaction.findById(returnRequest.transaction);
    if (txn && isValidTransition(txn.status, orderStates.RETURN_IN_TRANSIT)) {
      txn.status = orderStates.RETURN_IN_TRANSIT;
      txn.returnDetails = { ...txn.returnDetails, shippedAt: new Date(), buyerShippedAt: new Date(), trackingNumber: returnRequest.trackingNumber };
      await txn.save();
    }
    try {
      const seller = await User.findById(returnRequest.seller);
      if (seller) {
        seller.notifications.push({ type: 'shipping', from: req.user._id, listing: returnRequest.listing, message: `Return item shipped. Tracking: ${returnRequest.trackingNumber}`, read: false });
        await seller.save();
      }
    } catch (e) { console.error('Notify seller ship:', e.message); }
    res.json(returnRequest);
  } catch (error) {
    console.error('Ship return error:', error);
    res.status(500).json({ message: 'Failed to ship return' });
  }
});

// PUT /api/returns/:id/receive - Seller confirms return received and processes refund
// FULL refund semantics: restore listing, reverse boost fee, claw back seller balance,
// mark payout refunded, issue Stripe refund, sync to Transaction lifecycle.
router.put('/:id/receive', auth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.id);
    if (!returnRequest) return res.status(404).json({ message: 'Return not found' });
    if (returnRequest.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (returnRequest.status !== 'shipped') {
      return res.status(400).json({ message: 'Return must be shipped before receiving' });
    }
    const txn = await Transaction.findById(returnRequest.transaction);
    if (!txn) return res.status(404).json({ message: 'Associated transaction not found' });

    // Restore listing inventory - exact quantity bought
    try {
      await Listing.findByIdAndUpdate(txn.listing, {
        $inc: { quantity: txn.quantity || 1, quantitySold: -(txn.quantity || 1) },
        $set: { sold: false, available: true },
      });
    } catch (listingErr) { console.error('Restore listing on receive:', listingErr.message); }

    // Reverse boost fee + mark payout refunded
    await reverseBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
    await markPayoutRefunded(txn);

    // ============================================================
    // BUSINESS RULES: "Return shipping cost responsibility varies by
    // reason (buyer/seller)" — honour the classification recorded at
    // return creation:
    //   seller-responsibility → full refund of totalPaid (unchanged legacy
    //                           behaviour, Stripe amount omitted = full).
    //   buyer-responsibility  → refund the item price ONLY. Outbound
    //                           shipping + buyer protection stay with the
    //                           buyer (they also pay return shipping), so
    //                           the provider refund is PARTIAL.
    // ============================================================
    const responsibility = returnRequest.returnShippingResponsibility || 'seller';
    const totalPaid = txn.paymentBreakdown?.totalPaid || 0;
    const itemPrice = txn.itemPrice || txn.paymentBreakdown?.subtotal || 0;
    const buyerRefund = Math.round((responsibility === 'buyer' ? itemPrice : (totalPaid || returnRequest.refundAmount)) * 100) / 100;
    const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;

    // Issue Stripe refund to original payment method.
    // NOTE: single-item purchases (POST /api/transactions) record the funding
    // intent in paymentBreakdown.paymentIntentId and leave payout.transactionId
    // empty, while batch purchases set payout.transactionId. Resolve BOTH, or
    // the provider refund is silently skipped for every single-item return.
    const paymentIntentId = txn.payout?.transactionId || txn.paymentBreakdown?.paymentIntentId;
    if (paymentIntentId) {
      try {
        const { retrievePaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
        const pi = await retrievePaymentIntent(paymentIntentId);
        if (pi.status === 'succeeded') {
          await issueRefund(paymentIntentId, responsibility === 'buyer' ? buyerRefund : undefined);
        }
        else if (pi.status === 'requires_capture') { await releaseAuthorization(paymentIntentId); }
      } catch (stripeErr) { console.error('Stripe refund on receive:', stripeErr.message); }
    }

    // Claw back seller earnings from available or pending balance
    try {
      const seller = await User.findById(txn.seller);
      if (seller && seller.balance) {
        const available = seller.balance.available || 0;
        const pending = seller.balance.pending || 0;
        let remaining = sellerEarnings;
        if (available >= remaining) { seller.balance.available = available - remaining; remaining = 0; }
        else { seller.balance.available = 0; remaining = remaining - available; }
        if (remaining > 0) { seller.balance.pending = Math.max(0, pending - remaining); }
        seller.balance.totalEarned = Math.max(0, (seller.balance.totalEarned || 0) - sellerEarnings);
        seller.notifications.unshift({ type: 'sale', listing: txn.listing, transaction: txn._id, message: `Return received and confirmed. ${buyerRefund} ${txn.currency || 'USD'} refunded to buyer.` });
        await seller.save();
      }
    } catch (sellerErr) { console.error('Claw back seller earnings:', sellerErr.message); }

    // Update Return model + sync Transaction to REFUNDED.
    // Reconcile refundAmount with what was actually refunded (per
    // responsibility) so the document never contradicts the payout.
    returnRequest.status = 'refunded';
    returnRequest.refundAmount = buyerRefund;
    await returnRequest.save();
    if (isValidTransition(txn.status, orderStates.REFUNDED)) {
      txn.status = orderStates.REFUNDED;
      txn.returnDetails = { ...txn.returnDetails, receivedAt: new Date(), inspectionNotes: req.body.inspectionNotes || '' };
      txn.payout = { status: 'refunded', processedAt: new Date() };
      await txn.save();
      try { await syncOrderFromTransaction(txn, orderStates.REFUNDED); } catch {}
    }

    try {
      const buyer = await User.findById(returnRequest.buyer);
      if (buyer) {
        buyer.notifications.push({ type: 'payout', from: req.user._id, listing: returnRequest.listing, message: `Your return has been processed. Refund of $${buyerRefund.toFixed(2)} will be issued.`, read: false });
        await buyer.save();
      }
    } catch (e) { console.error('Notify buyer refund:', e.message); }

    res.json(returnRequest);
  } catch (error) {
    console.error('Receive return error:', error);
    res.status(500).json({ message: 'Failed to receive return' });
  }
});

module.exports = router;

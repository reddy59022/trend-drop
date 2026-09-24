/**
 * TrendDrop Cron Jobs
 * 
 * Handles automated tasks:
 * 1. Auto-expire listings (expiresAt past)
 * 2. Auto-complete orders (3 days after buyer confirmation)
 * 3. Auto-confirm delivery (3 days after delivery without buyer action)
 * 4. Release rolling reserve amounts (60 days)
 * 5. Clean up expired verification tokens
 */

const cron = require('node-cron');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Payout = require('../models/Payout');
const PendingUser = require('../models/PendingUser');
const Auction = require('../models/Auction');
const Return = require('../models/Return');
const Offer = require('../models/Offer');

const { orderStates, timeWindows } = require('./orderLifecycle');
const { releaseSellerEarnings, settlementAlreadyApplied, clawbackSellerEarnings } = require('../utils/balances');
const { claimTransaction } = require('../utils/claims');
const { releaseSellerSettlement } = require('../utils/settlement');
const { retrievePaymentIntent, findPaymentIntent, issueRefund, releaseAuthorization } = require('./payments');
const { trackingStatuses, simulateTrackingUpdate } = require('./shipping');
const { reverseBoostFeeOwed, markPayoutRefunded } = require('../routes/orderLifecycle');

// ──────────────────────────────────────────────
// JOB 1: Auto-Expire Listings (Every 6 hours)
// ──────────────────────────────────────────────
// Listings with expiresAt < now get status = 'expired'
// and available = false
async function expireListings() {
  try {
    const now = new Date();
    const result = await Listing.updateMany(
      { 
        expiresAt: { $lt: now, $ne: null },
        available: true,
        status: 'active',
      },
      { 
        $set: { 
          status: 'draft',
          available: false,
        }
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`[CRON] Auto-expired ${result.modifiedCount} listings`);
    }
    return result.modifiedCount;
  } catch (error) {
    console.error('[CRON] Error expiring listings:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 2: Auto-Complete Orders (Every hour)
// ──────────────────────────────────────────────
// Moves buyer_confirmed → completed after 3 days
// Also moves delivered → buyer_confirmed after 3 days
//
// No-shipment standard: a seller has 7 calendar days from payment to obtain
// carrier acceptance. A label/QR code alone is not shipment proof. At the
// deadline the platform atomically cancels the unshipped transaction, voids
// the label, releases any uncaptured authorization or fully refunds a capture,
// restores inventory, and claws back only the seller amount actually credited.
async function autoCancelUnshippedOrders(now = Date.now()) {
  const deadline = new Date(now - timeWindows.SELLER_SHIPMENT_DEADLINE);
  const candidates = await Transaction.find({
    status: { $in: [orderStates.PAID, orderStates.PROCESSING] },
    createdAt: { $lte: deadline },
    'shipping.actualDelivery': { $exists: false },
  });
  let cancelled = 0;

  for (const candidate of candidates) {
    // Claim before contacting the provider or mutating inventory. A seller
    // shipping concurrently can only win if the transaction is still paid.
    const claimed = await Transaction.findOneAndUpdate(
      { _id: candidate._id, status: { $in: [orderStates.PAID, orderStates.PROCESSING] } },
      { $set: { status: orderStates.AUTO_CANCELLED } },
      { new: true },
    );
    if (!claimed) continue;

    const paymentIntentId = claimed.payout?.transactionId || claimed.paymentBreakdown?.paymentIntentId || claimed.stripePaymentIntentId;
    try {
      if (!paymentIntentId) throw new Error('Missing payment provider reference; cancellation requires manual finance reconciliation');
      // Strict lookup: retrievePaymentIntent intentionally fabricates a
      // succeeded mock for legacy callers, but a money-moving cancellation
      // must fail closed when the provider reference is unknown.
      const storedIntent = await findPaymentIntent(paymentIntentId);
      if (!storedIntent) throw new Error('Payment provider reference was not found');
      const intent = await retrievePaymentIntent(paymentIntentId);
      if (intent.status === 'requires_capture') await releaseAuthorization(paymentIntentId);
      else if (intent.status === 'succeeded') await issueRefund(paymentIntentId, claimed.paymentBreakdown?.totalPaid || 0);
      else if (!['canceled', 'cancelled', 'refunded'].includes(intent.status)) {
        throw new Error(`Payment provider returned non-refundable status: ${intent.status}`);
      }

      // Label creation is not shipment. Void it so a cancelled order cannot
      // later be printed or handed to a carrier under the old authorization.
      claimed.shipping = {
        ...claimed.shipping,
        voided: Boolean(claimed.shipping?.labelCreated || claimed.shipping?.trackingNumber),
        voidedAt: claimed.shipping?.labelCreated || claimed.shipping?.trackingNumber ? new Date() : claimed.shipping?.voidedAt,
        labelCreated: false,
      };
      claimed.cancellation = {
        cancelledBy: 'system',
        reason: 'Seller did not obtain carrier acceptance within 7 calendar days',
        cancelledAt: new Date(now),
        refundAmount: Math.round((claimed.paymentBreakdown?.totalPaid || 0) * 100) / 100,
      };
      claimed.payout.status = 'refunded';

      await Listing.findByIdAndUpdate(claimed.listing, {
        $inc: { quantity: claimed.quantity || 1, quantitySold: -(claimed.quantity || 1) },
        $set: { sold: false, available: true },
      });
      await Payout.updateMany({ transaction: claimed._id, status: { $ne: 'refunded' } }, { $set: { status: 'refunded', refundedAt: new Date(now) } });

      const sellerEarnings = Math.round((claimed.paymentBreakdown?.sellerEarnings || 0) * 100) / 100;
      if (sellerEarnings > 0) {
        await User.updateOne({ _id: claimed.seller }, [
          { $set: { 'balance.pending': { $max: [0, { $subtract: [{ $ifNull: ['$balance.pending', 0] }, sellerEarnings] }] }, 'balance.totalEarned': { $max: [0, { $subtract: [{ $ifNull: ['$balance.totalEarned', 0] }, sellerEarnings] }] } } },
        ]);
      }
      await claimed.save();
      const { reverseBoostFeeOwed, syncOrderFromTransaction } = require('../routes/orderLifecycle');
      await reverseBoostFeeOwed(claimed.listing, claimed.paymentBreakdown?.boostFee || 0);
      await syncOrderFromTransaction(claimed, 'refunded', claimed.paymentBreakdown?.totalPaid || 0);
      cancelled++;
    } catch (error) {
      // Provider failure must never leave a local cancellation that claims a
      // refund happened. Return to the original fulfillment state for retry;
      // inventory and balances have not been touched before this point.
      await Transaction.updateOne({ _id: claimed._id, status: orderStates.AUTO_CANCELLED }, { $set: { status: candidate.status } });
      console.error(`[CRON] Failed to auto-cancel unshipped transaction ${claimed._id}:`, error.message);
    }
  }
  return cancelled;
}

async function autoProcessOrders() {
  try {
    await autoCancelUnshippedOrders();
    const now = Date.now();
    let completed = 0;
    let confirmed = 0;
    let failed = 0;

    // 2a. Auto-advance delivered → buyer_confirmed after 3 days
    const deliveredOrders = await Transaction.find({
      status: 'delivered',
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of deliveredOrders) {
      const deliveryTime = txn.shipping?.actualDelivery 
        ? new Date(txn.shipping.actualDelivery).getTime() 
        : new Date(txn.updatedAt).getTime();
      
      if (now - deliveryTime >= timeWindows.BUYER_CONFIRM_DELIVERY) {
        // Isolate this shipment: a failure here must not abort the job before
        // the fund-release phase below has run for anyone.
        try {
          txn.status = 'buyer_confirmed';
          txn.buyerConfirmed = {
            received: true,
            confirmedAt: new Date(),
            autoConfirmed: true,
          };
          await txn.save();
          confirmed++;
        } catch (advanceError) {
          console.error(`[CRON] Auto-confirm failed for ${txn._id}:`, advanceError.message);
        }
      }
    }

    // 2b. Auto-advance buyer_confirmed → completed (release funds)
    const confirmedOrders = await Transaction.find({
      status: 'buyer_confirmed',
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of confirmedOrders) {
      const confirmTime = txn.buyerConfirmed?.confirmedAt 
        ? new Date(txn.buyerConfirmed.confirmedAt).getTime() 
        : new Date(txn.updatedAt).getTime();
      
      if (now - confirmTime >= timeWindows.AUTO_COMPLETE) {
        const deliveredTime = txn.shipping?.actualDelivery
          ? new Date(txn.shipping.actualDelivery).getTime()
          : null;
        // The cron path must enforce the same delivery-based return hold as
        // the manual endpoint. Checking only buyer confirmation can release
        // seller funds before the buyer's return window has expired.
        if (deliveredTime && now - deliveredTime < timeWindows.PAYOUT_HOLD_FROM_DELIVERY) {
          continue;
        }

        // Claim before any balance, stats, or payout mutation. Overlapping cron
        // runs must not release one transaction twice — and a claim abandoned
        // by a dead worker (deploy restart mid-completion) is reclaimed instead
        // of stranding the order forever. See utils/claims.js.
        const claimed = await claimTransaction({
          _id: txn._id,
          flag: 'completionProcessing',
          claimedAt: 'completionClaimedAt',
          extraFilter: { status: 'buyer_confirmed' },
        });
        if (!claimed) continue;
        txn.completionProcessing = true;

        // Isolate this order: a failure below must neither abort the remaining
        // orders nor leave this one claimed forever. Without this, ONE poisoned
        // row stops every other seller's payout on every run, because each new
        // run walks back into the same wall.
        //
        // The retry this enables is safe because the release itself is
        // exactly-once: `settlementKey: txn._id` makes a second attempt a no-op
        // on the seller's balance, so releasing the claim can only complete the
        // order, never pay for it twice.
        try {
          const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;
  
          // Release funds to seller with 10% rolling reserve + new seller hold
          const seller = await User.findById(txn.seller);
          if (!seller) {
            await Transaction.updateOne(
              { _id: txn._id, completionProcessing: true },
              { $set: { completionProcessing: false } },
            );
            continue;
          }
          if (sellerEarnings > 0) {
            const isNewSeller = (seller.stats.totalSales || 0) < timeWindows.NEW_SELLER_THRESHOLD;
            let canRelease = true;
            
            if (isNewSeller) {
              const accountAge = Date.now() - new Date(seller.createdAt).getTime();
              if (accountAge < timeWindows.NEW_SELLER_HOLD) {
                canRelease = false;
              }
            }
            
            // False when an earlier attempt already moved this order's money
            // (see releaseSellerEarnings). The sale counters and the "payment
            // released" notice must then be skipped as well: telling a seller
            // twice that they were paid invites a double-refund dispute, and
            // re-incrementing totalSales can push them out of the new-seller
            // hold early.
            let settlementApplied = true;
            let sellerNotification = null;
            if (canRelease) {
              // Use the same atomic balance helper as the manual completion path.
              // Read-modify-save here could lose a concurrent payout/refund.
              const reserveAmount = Math.round(sellerEarnings * timeWindows.SELLER_RESERVE_PERCENT * 100) / 100;
              const availableAmount = sellerEarnings - reserveAmount;
              const release = await releaseSellerEarnings(seller._id, {
                earnings: sellerEarnings,
                availableAmount,
                reserveAmount,
                settlementKey: txn._id,
                reserveRelease: {
                  amount: reserveAmount,
                  releaseDate: new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS),
                  transactionId: txn._id,
                },
              });
              settlementApplied = !settlementAlreadyApplied(release);
              sellerNotification = `Payment of ${availableAmount} ${txn.currency} released; ${reserveAmount} ${txn.currency} held in reserve.`;
            } else {
              // New seller hold - funds stay in pending. Recording WHEN the
              // hold matures is what lets a later job pay the seller at all;
              // the order is already completed, so nothing else revisits it.
              txn.settlementHold = {
                reason: 'new_seller',
                releaseAfter: new Date(new Date(seller.createdAt).getTime() + timeWindows.NEW_SELLER_HOLD),
                releasedAt: null,
              };
              console.log(`[CRON] New seller hold active for seller ${seller._id}`);
              sellerNotification = 'Payment held: New seller hold is active.';
            }
  
            if (settlementApplied) {
              await User.updateOne(
                { _id: seller._id },
                {
                  $inc: { 'stats.totalSales': 1 },
                  $push: {
                    notifications: {
                      $each: [{
                        type: 'sale',
                        listing: txn.listing,
                        transaction: txn._id,
                        message: sellerNotification,
                      }],
                      $position: 0,
                    },
                  },
                },
              );
            }
          }
  
          // Update buyer stats
          const buyer = await User.findById(txn.buyer);
          if (buyer) {
            buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
            await buyer.save();
          }
  
          txn.status = 'completed';
          txn.completionProcessing = false;
          await txn.save();
  
          // Create payout record if not exists
          try {
            const existingPayout = await Payout.findOne({ transaction: txn._id });
            if (!existingPayout) {
              const itemPrice = txn.paymentBreakdown?.subtotal || txn.itemPrice || 0;
              // Keep the payout ledger aligned with the checkout breakdown.
              // Falling back to 10% here overstates seller commission and leaks
              // 2% of every legacy/auto-completed sale whose breakdown omits the
              // field. The platform rule is 8%.
              const commissionRate = (txn.paymentBreakdown?.platformFeePercent ?? 8) / 100;
              const storedCommission = txn.paymentBreakdown?.platformFee;
              const commissionAmount = Number.isFinite(storedCommission) && storedCommission > 0
                ? storedCommission
                : Math.round(itemPrice * commissionRate * 100) / 100;
              const payoutAmount = txn.paymentBreakdown?.sellerEarnings || sellerEarnings;
              // An order whose payout was deferred by a hold is not paid yet.
              // Recording it as 'completed' reports the money as available
              // while it is still escrowed; releaseHeldSettlements upgrades
              // this row once the hold matures.
              const fundsHeld = Boolean(txn.settlementHold?.releaseAfter);
              await Payout.create({
                seller: txn.seller,
                transaction: txn._id,
                listing: txn.listing,
                salePrice: itemPrice,
                commissionRate,
                commissionAmount,
                payoutAmount,
                status: fundsHeld ? 'pending' : 'completed',
                paidAt: fundsHeld ? undefined : new Date(),
              });
            }
          } catch (pErr) {
            console.error('[CRON] Auto-payout error:', pErr.message);
          }
  
          completed++;
        } catch (txnError) {
          // Release the claim so a later run retries THIS order, then keep
          // processing the orders that are still healthy.
          failed++;
          console.error(`[CRON] Order ${txn._id} failed to auto-complete:`, txnError.message);
          try {
            await Transaction.updateOne(
              { _id: txn._id, completionProcessing: true },
              { $set: { completionProcessing: false } },
            );
          } catch (rollbackError) {
            console.error(`[CRON] Claim rollback failed for ${txn._id}:`, rollbackError.message);
          }
        }
      }
    }

    if (completed > 0 || confirmed > 0 || failed > 0) {
      console.log(`[CRON] Auto-processed: ${confirmed} confirmed, ${completed} completed, ${failed} failed`);
    }
  } catch (error) {
    console.error('[CRON] Error auto-processing orders:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 3: Release Rolling Reserve (Daily)
// ──────────────────────────────────────────────
// Releases seller.balance.reserve amounts that
// have passed their 60-day hold period
async function releaseReserves() {
  try {
    const now = Date.now();
    const sellers = await User.find({
      'balance.reserveReleaseDate': { $exists: true, $ne: [] },
    });

    for (const seller of sellers) {
      if (!seller.balance.reserveReleaseDate || seller.balance.reserveReleaseDate.length === 0) continue;
      
      // Isolate each seller: one account whose reserve write fails must not
      // block every OTHER seller's matured reserve. Without this, a single
      // poisoned row stops the whole daily job before it reaches the rest of
      // the queue.
      try {
        const toRelease = [];
        const remaining = [];
  
        for (const entry of seller.balance.reserveReleaseDate) {
          if (new Date(entry.releaseDate).getTime() <= now) {
            toRelease.push(entry);
          } else {
            remaining.push(entry);
          }
        }
  
        if (toRelease.length > 0) {
          const totalRelease = toRelease.reduce((sum, e) => sum + (e.amount || 0), 0);
          seller.balance.reserve = Math.max(0, (seller.balance.reserve || 0) - totalRelease);
          seller.balance.available = (seller.balance.available || 0) + totalRelease;
          seller.balance.reserveReleaseDate = remaining;
          await seller.save();
          console.log(`[CRON] Released ${totalRelease} reserve for seller ${seller._id}`);
        }
      } catch (sellerError) {
        console.error(`[CRON] Reserve release failed for seller ${seller._id}:`, sellerError.message);
      }
    }
  } catch (error) {
    console.error('[CRON] Error releasing reserves:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 5: Auto-Process Return Requests (Every hour)
// ──────────────────────────────────────────────
// Return settlement is deliberately centralized here. Carrier delivery is
// treated as proof that the buyer returned the item; no seller action is
// required to release the buyer's refund. Every monetary mutation is behind
// the transaction returnProcessing claim, so overlapping cron runs settle once.
async function settleDeliveredReturn(txn, returnRequest, now) {
  const priorStatus = txn.status;
  // The claim also parks the return in `return_delivered`, so it moves the flag
  // and the state together — and a claim abandoned by a dead worker is
  // reclaimed instead of leaving the buyer's refund stuck forever.
  const claimed = await claimTransaction({
    _id: txn._id,
    flag: 'returnProcessing',
    claimedAt: 'returnClaimedAt',
    extraFilter: { status: { $in: [orderStates.RETURN_IN_TRANSIT, orderStates.RETURN_DELIVERED] } },
    extraSet: { status: orderStates.RETURN_DELIVERED },
  });
  if (!claimed) return false;

  try {
    const paymentIntentId = claimed.payout?.transactionId || claimed.paymentBreakdown?.paymentIntentId || claimed.stripePaymentIntentId;
    if (!paymentIntentId) throw new Error('Missing payment provider reference');
    const storedIntent = await findPaymentIntent(paymentIntentId);
    if (!storedIntent) throw new Error('Payment provider reference was not found');
    const intent = await retrievePaymentIntent(paymentIntentId);
    const responsibility = returnRequest.returnShippingResponsibility || 'seller';
    const totalPaid = claimed.paymentBreakdown?.totalPaid || 0;
    const itemPrice = claimed.itemPrice || claimed.paymentBreakdown?.subtotal || 0;
    const refundAmount = Math.round((responsibility === 'buyer' ? itemPrice : totalPaid) * 100) / 100;

    if (!returnRequest.providerRefunded) {
      if (intent.status === 'requires_capture') await releaseAuthorization(paymentIntentId);
      else if (intent.status === 'succeeded') await issueRefund(paymentIntentId, responsibility === 'buyer' ? refundAmount : undefined);
      else if (!['canceled', 'cancelled', 'refunded'].includes(intent.status)) throw new Error(`Non-settleable provider status: ${intent.status}`);
      returnRequest.providerRefunded = true;
      await returnRequest.save();
    }

    if (!returnRequest.inventoryRestored) {
      await Listing.findByIdAndUpdate(claimed.listing, {
        $inc: { quantity: claimed.quantity || 1, quantitySold: -(claimed.quantity || 1) },
        $set: { sold: false, available: true },
      });
      returnRequest.inventoryRestored = true;
      await returnRequest.save();
    }
    if (!returnRequest.boostReversed) {
      await reverseBoostFeeOwed(claimed.listing, claimed.paymentBreakdown?.boostFee || 0);
      returnRequest.boostReversed = true;
      await returnRequest.save();
    }
    if (!returnRequest.payoutMarkedRefunded) {
      await markPayoutRefunded(claimed);
      returnRequest.payoutMarkedRefunded = true;
      await returnRequest.save();
    }
    if (!returnRequest.sellerLedgerClawedBack && claimed.paymentBreakdown?.sellerEarnings > 0) {
      await clawbackSellerEarnings(claimed.seller, claimed.paymentBreakdown.sellerEarnings);
      returnRequest.sellerLedgerClawedBack = true;
      await returnRequest.save();
    }

    returnRequest.status = 'refunded';
    returnRequest.refundAmount = refundAmount;
    returnRequest.deliveredAt = returnRequest.deliveredAt || new Date(now);
    returnRequest.trackingStatus = 'delivered';
    await returnRequest.save();

    claimed.status = orderStates.REFUNDED;
    claimed.returnProcessing = false;
    claimed.returnDetails = { ...claimed.returnDetails, receivedAt: returnRequest.deliveredAt, autoRefunded: true, autoRefundedAt: new Date(now), refundAmount };
    claimed.payout = { status: 'refunded', processedAt: new Date(now) };
    await claimed.save();
    const { syncOrderFromTransaction } = require('../routes/orderLifecycle');
    await syncOrderFromTransaction(claimed, orderStates.REFUNDED, refundAmount);
    return true;
  } catch (error) {
    await Transaction.updateOne(
      { _id: claimed._id, status: orderStates.RETURN_DELIVERED, returnProcessing: true },
      { $set: { status: orderStates.RETURN_DELIVERED, returnProcessing: false } },
    );
    console.error(`[CRON] Return settlement failed for ${claimed._id}:`, error.message);
    return false;
  }
}

async function autoProcessReturnTracking(now = Date.now()) {
  const transactions = await Transaction.find({
    status: { $in: [orderStates.RETURN_IN_TRANSIT, orderStates.RETURN_DELIVERED] },
    'returnDetails.trackingNumber': { $nin: ['', null] },
    'payout.status': { $ne: 'refunded' },
  });
  let updated = 0;
  let settled = 0;
  const labels = new Map(trackingStatuses.map((s) => [s.code, s]));

  for (const txn of transactions) {
    const returnRequest = txn.returnDetails?.returnId ? await Return.findById(txn.returnDetails.returnId) : null;
    if (!returnRequest || returnRequest.status === 'refunded') continue;
    const shippedAt = txn.returnDetails?.buyerShippedAt ? new Date(txn.returnDetails.buyerShippedAt).getTime() : now;
    const daysSinceShipment = Math.max(0, Math.floor((now - shippedAt) / (24 * 60 * 60 * 1000)));
    const current = returnRequest.trackingStatus || 'picked_up';
    const next = simulateTrackingUpdate(current, daysSinceShipment);
    if (next !== current) {
      const currentIndex = trackingStatuses.findIndex((s) => s.code === current);
      const nextIndex = trackingStatuses.findIndex((s) => s.code === next);
      returnRequest.trackingStatus = next;
      returnRequest.trackingHistory = returnRequest.trackingHistory || [];
      // A polling interval can skip several carrier events. Backfill every
      // ordered milestone so return tracking has the same complete timeline
      // as outbound order tracking instead of jumping label_created → delivered.
      for (let i = Math.max(0, currentIndex + 1); i <= nextIndex; i += 1) {
        const milestone = trackingStatuses[i];
        if (!milestone || milestone.sortOrder < 0) continue;
        returnRequest.trackingHistory.push({ status: milestone.code, label: milestone.label, description: milestone.description, timestamp: new Date(now), location: 'Carrier polling' });
      }
      if (next === 'delivered') {
        returnRequest.status = 'delivered';
        returnRequest.deliveredAt = new Date(now);
        txn.returnDetails = { ...txn.returnDetails, deliveredAt: new Date(now) };
        await txn.save();
      } else if (next === 'in_transit' || next === 'out_for_delivery') {
        returnRequest.status = next;
      }
      await returnRequest.save();
      updated++;
    }
    if (next === 'delivered' || returnRequest.status === 'delivered') {
      if (await settleDeliveredReturn(txn, returnRequest, now)) settled++;
    }
  }
  return { updated, settled };
}

// 5a. Auto-reject returns where seller hasn't responded after 3 days
// 5b. Auto-refund where buyer hasn't shipped return after 7 days of acceptance
async function autoProcessReturns() {
  try {
    const tracking = await autoProcessReturnTracking();
    const now = Date.now();
    let autoRejected = 0;
    let autoRefunded = 0;
    // Counted separately from `autoRefunded`: an expired return is finalized
    // WITHOUT a refund (the buyer kept the item), and mixing the two made the
    // run report claim refunds that never happened.
    let autoExpired = 0;

    // 5a. Auto-reject: return_requested + seller no response after 3 days
    const pendingReturns = await Transaction.find({
      status: 'return_requested',
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of pendingReturns) {
      const requestedAt = txn.returnDetails?.requestedAt 
        ? new Date(txn.returnDetails.requestedAt).getTime() 
        : new Date(txn.updatedAt).getTime();
      
      if (now - requestedAt >= timeWindows.SELLER_RESPOND_RETURN) {
        // Auto-reject: seller didn't respond in time
        txn.status = 'return_rejected';
        txn.returnDetails = {
          ...txn.returnDetails,
          rejectionReason: 'Auto-rejected: Seller did not respond within 3 days',
          autoRejected: true,
          autoRejectedAt: new Date(),
        };
        
        // Notify buyer
        const buyer = await User.findById(txn.buyer);
        if (buyer) {
          buyer.notifications.unshift({
            type: 'sale',
            listing: txn.listing,
            transaction: txn._id,
            message: 'Return request auto-rejected. Seller did not respond within 3 days.',
          });
          await buyer.save();
        }
        
        await txn.save();
        // Sync linked Return doc (Returns Center path)
        try {
          if (txn.returnDetails?.returnId) {
            await Return.findByIdAndUpdate(txn.returnDetails.returnId, { $set: { status: 'denied' } });
          }
        } catch (e) { console.error('[CRON 5a] Failed to sync Return doc:', e.message); }
        autoRejected++;
      }
    }

    // 5b. Auto-refund: return_accepted + buyer hasn't shipped after 7 days
    const acceptedReturns = await Transaction.find({
      status: 'return_accepted',
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of acceptedReturns) {
      const acceptedAt = txn.returnDetails?.acceptedAt 
        ? new Date(txn.returnDetails.acceptedAt).getTime() 
        : new Date(txn.updatedAt).getTime();
      
      if (now - acceptedAt >= timeWindows.RETURN_SHIP_WINDOW) {
        // The buyer never shipped, so the return expires and the sale stands:
        // the seller keeps the money. Moving it is THIS job's responsibility —
        // the completion job only watches `buyer_confirmed`, so an order that
        // gets finalized here is never looked at again and any still-escrowed
        // earnings would sit in `balance.pending` forever.
        //
        // Paying is only correct when the money is still escrowed, though: a
        // return can also be opened on an order that already paid its seller
        // (completed → return_requested). Three independent signals say the
        // seller has NOT been paid yet: no release marker on the balance, no
        // `completed` payout in the ledger, and no pending settlement hold.
        try {
          const sellerDoc = await User.findById(txn.seller).select('balance.settledTransactions').lean();
          const alreadyReleased = Boolean(sellerDoc?.balance?.settledTransactions
            ?.some((id) => String(id) === String(txn._id)));
          const holdPending = Boolean(txn.settlementHold?.releaseAfter && !txn.settlementHold?.releasedAt);
          const payoutCompleted = await Payout.exists({ transaction: txn._id, status: 'completed' });

          if (!alreadyReleased && !holdPending && !payoutCompleted) {
            const { paid } = await releaseSellerSettlement(txn, { now });
            if (paid) {
              // The sale stands, so it counts as a sale.
              await User.updateOne({ _id: txn.seller }, { $inc: { 'stats.totalSales': 1 } });
            }
          }

          txn.status = 'completed';
          txn.returnDetails = {
            ...txn.returnDetails,
            autoExpired: true,
            autoExpiredAt: new Date(now),
          };
          await txn.save();
          // Sync linked Return doc (Returns Center path)
          try {
            if (txn.returnDetails?.returnId) {
              await Return.findByIdAndUpdate(txn.returnDetails.returnId, { $set: { status: 'denied' } });
            }
          } catch (e) { console.error('[CRON 5b] Failed to sync Return doc:', e.message); }
          // Roll the finalized sale up to the consolidated Enterprise Order,
          // exactly like the other completion paths do; without it an order
          // whose return expired stays stuck in its return state in the
          // order-level view. No-ops when no order references this txn.
          try {
            const { syncOrderFromTransaction } = require('../routes/orderLifecycle');
            await syncOrderFromTransaction(txn, 'completed');
          } catch (e) { console.error('[CRON 5b] Failed to sync Order doc:', e.message); }
          autoExpired++;
        } catch (expireError) {
          // Keep the hour's other expiries moving; this one retries next run.
          console.error(`[CRON 5b] Return expiry failed for ${txn._id}:`, expireError.message);
        }
      }
    }

    if (tracking.updated || tracking.settled || autoRejected > 0 || autoExpired > 0 || autoRefunded > 0) {
      console.log(`[CRON] Auto-processed returns: ${tracking.updated} tracking updates, ${tracking.settled} settled, ${autoRejected} rejected, ${autoExpired} expired, ${autoRefunded} refunded`);
    }

    // 5c. Auto-refund: return_in_transit + seller never confirms return
    // received after RETURN_DELIVERY_WINDOW (7 days from buyer ship).
    // Business rule: a seller cannot hold a buyer's refund hostage by
    // simply never confirming the returned item arrived.
    const inTransitReturns = await Transaction.find({
      status: orderStates.RETURN_IN_TRANSIT,
      'payout.status': { $ne: 'refunded' },
      // New return records are settled by autoProcessReturnTracking above,
      // which has the atomic claim and step markers. Keep this legacy fallback
      // limited to pre-returnId transactions so the two jobs cannot double
      // restock or refund the same order.
      'returnDetails.returnId': { $exists: false },
    });

    for (const txn of inTransitReturns) {
      const shippedAt = txn.returnDetails?.buyerShippedAt
        ? new Date(txn.returnDetails.buyerShippedAt).getTime()
        : new Date(txn.updatedAt).getTime();

      if (now - shippedAt < timeWindows.RETURN_DELIVERY_WINDOW) continue;

      try {
        // Restore listing inventory — exact quantity bought
        await Listing.findByIdAndUpdate(txn.listing, {
          $inc: { quantity: txn.quantity || 1, quantitySold: -(txn.quantity || 1) },
          $set: { sold: false, available: true },
        });

        // Reverse any boost fee owed (boost fee is never charged for a returned order)
        const { reverseBoostFeeOwed, markPayoutRefunded, syncOrderFromTransaction } = require('../routes/orderLifecycle');
        await reverseBoostFeeOwed(txn.listing, txn.paymentBreakdown?.boostFee || 0);
        await markPayoutRefunded(txn);

        const refundAmount = txn.paymentBreakdown?.totalPaid || 0;
        const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;

        // Issue Stripe refund to original payment method.
        // Single-item purchases record the funding intent in
        // paymentBreakdown.paymentIntentId (payout.transactionId is only set
        // by batch confirm) — resolve BOTH or the refund is silently skipped.
        const paymentIntentId = txn.payout?.transactionId || txn.paymentBreakdown?.paymentIntentId;
        if (paymentIntentId) {
          try {
            const { retrievePaymentIntent, issueRefund, releaseAuthorization } = require('../config/payments');
            const pi = await retrievePaymentIntent(paymentIntentId);
            if (pi.status === 'succeeded') {
              await issueRefund(paymentIntentId);
            } else if (pi.status === 'requires_capture') {
              await releaseAuthorization(paymentIntentId);
            }
          } catch (stripeErr) {
            console.error('[CRON] Stripe refund on auto-return:', stripeErr.message);
          }
        }

        // Notify buyer of refund
        const buyer = await User.findById(txn.buyer);
        if (buyer) {
          buyer.notifications.unshift({
            type: 'sale',
            listing: txn.listing,
            transaction: txn._id,
            message: `Return auto-refunded. Refund of ${refundAmount} ${txn.currency} has been processed — seller did not confirm return receipt within ${timeWindows.RETURN_DELIVERY_WINDOW / (24 * 60 * 60 * 1000)} days.`,
          });
          await buyer.save();
        }

        // ROBUST: Claw back seller earnings from available or pending balance
        const seller = await User.findById(txn.seller);
        if (seller) {
          const available = seller.balance.available || 0;
          const pending = seller.balance.pending || 0;
          let remaining = sellerEarnings;
          if (available >= remaining) {
            seller.balance.available = available - remaining;
            remaining = 0;
          } else {
            seller.balance.available = 0;
            remaining = remaining - available;
          }
          if (remaining > 0) {
            seller.balance.pending = Math.max(0, pending - remaining);
          }
          seller.balance.totalEarned = Math.max(0, (seller.balance.totalEarned || 0) - sellerEarnings);
          seller.notifications.unshift({
            type: 'sale',
            listing: txn.listing,
            transaction: txn._id,
            message: `Return auto-confirmed after ${timeWindows.RETURN_DELIVERY_WINDOW / (24 * 60 * 60 * 1000)} days without receipt confirmation. ${refundAmount} ${txn.currency} refunded to buyer.`,
          });
          await seller.save();
        }

        txn.status = orderStates.REFUNDED;
        txn.returnDetails = {
          ...txn.returnDetails,
          receivedAt: new Date(),
          autoRefunded: true,
          autoRefundedAt: new Date(),
          autoRefundReason: 'Seller did not confirm return receipt within the delivery window',
        };
        txn.payout = { status: 'refunded', processedAt: new Date() };
        await txn.save();

        // Sync linked Return doc (Returns Center path)
        try {
          if (txn.returnDetails?.returnId) {
            await Return.findByIdAndUpdate(txn.returnDetails.returnId, { $set: { status: 'refunded' } });
          }
        } catch (e) { console.error('[CRON 5c] Failed to sync Return doc:', e.message); }


        // Keep consolidated Enterprise Order in sync
        await syncOrderFromTransaction(txn, 'refunded');

        autoRefunded++;
      } catch (txnErr) {
        console.error('[CRON] Auto-refund of unconfirmed return failed:', txnErr.message);
      }
    }

    return { rejected: autoRejected, expired: autoExpired, refunded: autoRefunded };
  } catch (error) {
    console.error('[CRON] Error auto-processing returns:', error.message);
    return { rejected: 0, expired: 0, refunded: 0 };
  }
}

// ──────────────────────────────────────────────
// JOB 4 (renumbered): Clean Expired Verification Tokens (Daily)
// ──────────────────────────────────────────────
async function cleanExpiredTokens() {
  try {
    const now = new Date();
    const result = await PendingUser.deleteMany({
      verificationTokenExpires: { $lt: now },
    });
    if (result.deletedCount > 0) {
      console.log(`[CRON] Cleaned ${result.deletedCount} expired verification tokens`);
    }
  } catch (error) {
    console.error('[CRON] Error cleaning tokens:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 6: Auto-Activate Scheduled Auctions (Every minute)
// ──────────────────────────────────────────────
// Scheduled auctions with startTime <= now become 'active'
async function activateAuctions() {
  try {
    const now = new Date();
    const result = await Auction.updateMany(
      {
        status: 'scheduled',
        startTime: { $lte: now },
      },
      {
        $set: { status: 'active' },
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`[CRON] Activated ${result.modifiedCount} scheduled auctions`);
    }
    return result.modifiedCount;
  } catch (error) {
    console.error('[CRON] Error activating auctions:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 7: Auto-Close Expired Auctions (Every minute)
// ──────────────────────────────────────────────
// Active auctions with endTime <= now become 'closed'
async function closeAuctions() {
  try {
    const now = new Date();
    const result = await Auction.updateMany(
      {
        status: 'active',
        endTime: { $lte: now },
      },
      {
        // Leave closeFinalized false so the seller/admin close endpoint can
        // finish winner selection, listing state, and transaction creation.
        $set: { status: 'closed', closeFinalized: false },
      }
    );
    if (result.modifiedCount > 0) {
      console.log(`[CRON] Closed ${result.modifiedCount} expired auctions`);
      // Winner determination happens in the close endpoint
      // but we could also do it here for auto-closing
    }
    return result.modifiedCount;
  } catch (error) {
    console.error('[CRON] Error closing auctions:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 8: Auto-Expire Offers (Every 30 minutes)
// ──────────────────────────────────────────────
// Pending/countered offers with expiresAt < now get status = 'expired'
async function expireOffers() {
  try {
    const now = new Date();
    const result = await Offer.updateMany(
      { 
        expiresAt: { $lt: now },
        status: { $in: ['pending', 'countered', 'buyer_countered'] },
      },
      { 
        $set: { status: 'expired' }
      }
    );
    const accepted = await Offer.updateMany(
      { acceptedUntil: { $lt: now }, status: 'accepted' },
      { $set: { status: 'expired' } }
    );
    const total = (result.modifiedCount || 0) + (accepted.modifiedCount || 0);
    if (total > 0) {
      console.log(`[CRON] Auto-expired ${total} offers`);
    }
    return total;
  } catch (error) {
    console.error('[CRON] Error expiring offers:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 9: Auto-Expire Shop Boosts (daily at 4:00 AM)
// Feature 3 — expired "boost whole shop" toggles are turned off and the
// listings revert to their individual boost state.
// ──────────────────────────────────────────────
async function expireShopBoosts() {
  try {
    const { expireExpiredShopBoosts } = require('../services/shopBoostService');
    const count = await expireExpiredShopBoosts();
    if (count > 0) {
      console.log(`[CRON] Auto-expired ${count} shop boost(s)`);
    }
    return count;
  } catch (error) {
    console.error('[CRON] Error expiring shop boosts:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 10: Release Held Settlements (daily at 2:30 AM)
// ──────────────────────────────────────────────
// Completion can *defer* a seller's payout (the new-seller hold: account
// younger than 14 days, fewer than 5 sales). The deferral used to be permanent
// — the money stayed in `balance.pending`, the order was already `completed`
// (so the seller cannot re-run completion) and no job ever came back for it.
//
// Every hold is paid through releaseSellerEarnings' `settlementKey`, so a retry
// or an overlapping run can only move the money once, and the transaction is
// stamped `settlementHold.releasedAt` so it is not revisited.
async function releaseHeldSettlements(now = Date.now()) {
  let released = 0;
  let failed = 0;
  try {
    const held = await Transaction.find({
      status: 'completed',
      'settlementHold.releaseAfter': { $lte: new Date(now) },
      'settlementHold.releasedAt': null,
      'payout.status': { $ne: 'refunded' },
    });

    for (const txn of held) {
      // Isolate each hold: one unreleasable row must not block every other
      // seller's matured payout (and it stays queued for the next run).
      try {
        const { paid, reason } = await releaseSellerSettlement(txn, { now });
        if (reason === 'seller_missing') {
          // Leave the hold in place: it is evidence of an unpaid sale, and the
          // order is already `completed` so no other path will come for it.
          failed += 1;
          console.error(`[CRON] Held settlement ${txn._id} has no seller account; left for reconciliation`);
          continue;
        }
        // Stamped last: if a write above failed, the hold stays queued and the
        // next run retries it — the balance release itself is already
        // exactly-once, so a retry cannot pay the seller twice.
        await Transaction.updateOne(
          { _id: txn._id, 'settlementHold.releasedAt': null },
          { $set: { 'settlementHold.releasedAt': new Date(now) } },
        );
        if (paid) released += 1;
      } catch (holdError) {
        failed += 1;
        console.error(`[CRON] Held settlement ${txn._id} failed:`, holdError.message);
      }
    }

    if (released > 0 || failed > 0) {
      console.log(`[CRON] Held settlements: ${released} released, ${failed} failed`);
    }
  } catch (error) {
    console.error('[CRON] Error releasing held settlements:', error.message);
  }
  return { released, failed };
}

// ──────────────────────────────────────────────
// Initialize all cron jobs
// ──────────────────────────────────────────────
function initCronJobs() {
  // Don't run cron jobs in test environment
  if (process.env.NODE_ENV === 'test') {
    console.log('[CRON] Skipped (test mode)');
    return;
  }

  // Job 1: Expire listings every 6 hours
  // '0 */6 * * *' = at minute 0 of every 6th hour
  cron.schedule('0 */6 * * *', () => {
    expireListings();
  });
  console.log('[CRON] Listing auto-expiration scheduled (every 6 hours)');

  // Job 2: Auto-process orders every hour
  // '0 * * * *' = at minute 0 of every hour
  cron.schedule('0 * * * *', () => {
    autoProcessOrders();
  });
  console.log('[CRON] Order auto-processing scheduled (every hour)');

  // Job 3: Release reserves daily at 2:00 AM
  // '0 2 * * *' = at 2:00 AM every day
  cron.schedule('0 2 * * *', () => {
    releaseReserves();
  });
  console.log('[CRON] Reserve release scheduled (daily at 2:00 AM)');

  // Job 4: Clean expired tokens daily at 3:00 AM
  // '0 3 * * *' = at 3:00 AM every day
  cron.schedule('0 3 * * *', () => {
    cleanExpiredTokens();
  });
  console.log('[CRON] Token cleanup scheduled (daily at 3:00 AM)');

  // Job 5: Auto-process returns every hour
  // '30 * * * *' = at minute 30 of every hour (staggered from Job 2)
  cron.schedule('30 * * * *', () => {
    autoProcessReturns();
  });
  console.log('[CRON] Return auto-processing scheduled (every hour)');

  // Job 6: Auto-activate scheduled auctions every minute
  // '* * * * *' = every minute
  cron.schedule('* * * * *', () => {
    activateAuctions();
  });
  console.log('[CRON] Auction auto-activation scheduled (every minute)');

  // Job 7: Auto-close expired auctions every minute
  // '* * * * *' = every minute
  cron.schedule('* * * * *', () => {
    closeAuctions();
  });
  console.log('[CRON] Auction auto-close scheduled (every minute)');

  // Job 8: Auto-expire offers every 30 minutes
  // '*/30 * * * *' = every 30 minutes
  cron.schedule('*/30 * * * *', () => {
    expireOffers();
  });
  console.log('[CRON] Offer auto-expiration scheduled (every 30 minutes)');

  // Job 9: Auto-expire shop boosts daily at 4:00 AM
  // '0 4 * * *' = at 4:00 AM every day
  cron.schedule('0 4 * * *', () => {
    expireShopBoosts();
  });
  console.log('[CRON] Shop boost auto-expiration scheduled (daily at 4:00 AM)');

  // Job 10: Release seller funds withheld by a settlement hold daily at 2:30 AM
  // '30 2 * * *' = at 2:30 AM every day (after the reserve release at 2:00)
  cron.schedule('30 2 * * *', () => {
    releaseHeldSettlements();
  });
  console.log('[CRON] Held settlement release scheduled (daily at 2:30 AM)');
}

module.exports = {
  initCronJobs,
  expireListings,
  autoCancelUnshippedOrders,
  autoProcessOrders,
  autoProcessReturns,
  autoProcessReturnTracking,
  settleDeliveredReturn,
  releaseReserves,
  releaseHeldSettlements,
  cleanExpiredTokens,
  activateAuctions,
  closeAuctions,
  expireOffers,
  expireShopBoosts,
};

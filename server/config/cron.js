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
const { orderStates, timeWindows } = require('./orderLifecycle');

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
async function autoProcessOrders() {
  try {
    const now = Date.now();
    let completed = 0;
    let confirmed = 0;

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
        txn.status = 'buyer_confirmed';
        txn.buyerConfirmed = {
          received: true,
          confirmedAt: new Date(),
          autoConfirmed: true,
        };
        await txn.save();
        confirmed++;
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
        const sellerEarnings = txn.paymentBreakdown?.sellerEarnings || 0;

        // Release funds to seller with 10% rolling reserve + new seller hold
        const seller = await User.findById(txn.seller);
        if (seller && sellerEarnings > 0) {
          const isNewSeller = (seller.stats.totalSales || 0) < timeWindows.NEW_SELLER_THRESHOLD;
          let canRelease = true;
          
          if (isNewSeller) {
            const accountAge = Date.now() - new Date(seller.createdAt).getTime();
            if (accountAge < timeWindows.NEW_SELLER_HOLD) {
              canRelease = false;
            }
          }
          
          if (canRelease) {
            // Apply 10% rolling reserve
            const reserveAmount = Math.round(sellerEarnings * timeWindows.SELLER_RESERVE_PERCENT * 100) / 100;
            const availableAmount = sellerEarnings - reserveAmount;
            
            seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - sellerEarnings);
            seller.balance.available = (seller.balance.available || 0) + availableAmount;
            seller.balance.totalEarned = (seller.balance.totalEarned || 0) + sellerEarnings;
            
            // Track reserve
            if (!seller.balance.reserve) seller.balance.reserve = 0;
            if (!seller.balance.reserveReleaseDate) seller.balance.reserveReleaseDate = [];
            seller.balance.reserve += reserveAmount;
            seller.balance.reserveReleaseDate.push({
              amount: reserveAmount,
              releaseDate: new Date(Date.now() + timeWindows.SELLER_RESERVE_HOLD_DAYS),
              transactionId: txn._id,
            });
          } else {
            // New seller hold - funds stay in pending
            console.log(`[CRON] New seller hold active for seller ${seller._id}`);
          }
          
          seller.stats.totalSales = (seller.stats.totalSales || 0) + 1;
          await seller.save();
        }

        // Update buyer stats
        const buyer = await User.findById(txn.buyer);
        if (buyer) {
          buyer.stats.totalPurchases = (buyer.stats.totalPurchases || 0) + 1;
          await buyer.save();
        }

        txn.status = 'completed';
        await txn.save();

        // Create payout record if not exists
        try {
          const existingPayout = await Payout.findOne({ transaction: txn._id });
          if (!existingPayout) {
            const itemPrice = txn.paymentBreakdown?.subtotal || txn.itemPrice || 0;
            const commissionAmount = txn.paymentBreakdown?.platformFee || 0;
            const payoutAmount = txn.paymentBreakdown?.sellerEarnings || sellerEarnings;
            await Payout.create({
              seller: txn.seller,
              transaction: txn._id,
              listing: txn.listing,
              salePrice: itemPrice,
              commissionRate: (txn.paymentBreakdown?.platformFeePercent || 10) / 100,
              commissionAmount,
              payoutAmount,
              status: 'completed',
              paidAt: new Date(),
            });
          }
        } catch (pErr) {
          console.error('[CRON] Auto-payout error:', pErr.message);
        }

        completed++;
      }
    }

    if (completed > 0 || confirmed > 0) {
      console.log(`[CRON] Auto-processed: ${confirmed} confirmed, ${completed} completed`);
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
    }
  } catch (error) {
    console.error('[CRON] Error releasing reserves:', error.message);
  }
}

// ──────────────────────────────────────────────
// JOB 5: Auto-Process Return Requests (Every hour)
// ──────────────────────────────────────────────
// 5a. Auto-reject returns where seller hasn't responded after 3 days
// 5b. Auto-refund where buyer hasn't shipped return after 7 days of acceptance
async function autoProcessReturns() {
  try {
    const now = Date.now();
    let autoRejected = 0;
    let autoRefunded = 0;

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
        // Auto-refund: buyer didn't ship in time, restore order to completed
        txn.status = 'completed';
        txn.returnDetails = {
          ...txn.returnDetails,
          autoExpired: true,
          autoExpiredAt: new Date(),
        };
        
        await txn.save();
        autoRefunded++;
      }
    }

    if (autoRejected > 0 || autoRefunded > 0) {
      console.log(`[CRON] Auto-processed returns: ${autoRejected} rejected, ${autoRefunded} expired`);
    }
  } catch (error) {
    console.error('[CRON] Error auto-processing returns:', error.message);
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
}

module.exports = {
  initCronJobs,
  expireListings,
  autoProcessOrders,
  autoProcessReturns,
  releaseReserves,
  cleanExpiredTokens,
};

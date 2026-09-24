/**
 * Paying a completed order's escrowed earnings to its seller.
 *
 * Several code paths reach this state — completion, a return that the buyer
 * never shipped, and a new-seller hold that has matured — and each of them used
 * to carry its own copy of the release math, the seller notification, and the
 * payout ledger row. Copies drift: a path that forgets the release strands the
 * seller's money in `balance.pending` forever, and a path that forgets the
 * exactly-once key pays the same sale twice.
 *
 * The release itself is idempotent (`releaseSellerEarnings`' `settlementKey`
 * records the transaction on the seller's balance in the SAME atomic update as
 * the balance change), so this helper is safe to call on a retry, on an
 * overlapping cron run, or from a path that cannot tell whether an earlier
 * attempt already paid.
 */
const User = require('../models/User');
const Payout = require('../models/Payout');
const { releaseSellerEarnings, settlementAlreadyApplied, round2 } = require('./balances');
const { timeWindows } = require('../config/orderLifecycle');

/**
 * Credit a transaction's seller earnings (minus the rolling reserve) to their
 * available balance and make sure the payout ledger reflects it.
 *
 * @param {object} txn                   the transaction being settled
 * @param {object} [options]
 * @param {number} [options.now]         injectable clock (tests)
 * @param {string} [options.message]     seller notification text; defaults to
 *                                       the standard "payment released" notice
 * @returns {Promise<{paid: boolean, reason: string}>}
 *   `paid` is true only when THIS call moved the money; `reason` is one of
 *   'released', 'already_released', 'nothing_to_pay', 'seller_missing'.
 */
const releaseSellerSettlement = async (txn, { now = Date.now(), message = null } = {}) => {
  const seller = await User.findById(txn.seller);
  if (!seller) {
    // Never finalize a paid sale without a seller ledger to credit: leave the
    // caller's state untouched so finance can repair the account and retry.
    return { paid: false, reason: 'seller_missing' };
  }

  const sellerEarnings = round2(txn.paymentBreakdown?.sellerEarnings || 0);
  if (sellerEarnings <= 0) {
    return { paid: false, reason: 'nothing_to_pay' };
  }

  const reserveAmount = round2(sellerEarnings * timeWindows.SELLER_RESERVE_PERCENT);
  const availableAmount = round2(sellerEarnings - reserveAmount);

  const release = await releaseSellerEarnings(seller._id, {
    earnings: sellerEarnings,
    availableAmount,
    reserveAmount,
    settlementKey: txn._id,
    reserveRelease: {
      amount: reserveAmount,
      releaseDate: new Date(now + timeWindows.SELLER_RESERVE_HOLD_DAYS),
      transactionId: txn._id,
    },
  });
  const paid = !settlementAlreadyApplied(release);

  if (paid) {
    await User.updateOne(
      { _id: seller._id },
      {
        $push: {
          notifications: {
            $each: [{
              type: 'sale',
              listing: txn.listing,
              transaction: txn._id,
              message: message || `Payment of ${availableAmount} ${txn.currency} released; ${reserveAmount} ${txn.currency} held in reserve.`,
            }],
            $position: 0,
          },
        },
      },
    );
  }

  // The ledger row is normally written when the order completed; upsert so a
  // transaction that lost it still ends up accounted for, and so a row that was
  // left `pending` (funds were held at completion time) becomes `completed` now
  // that the money really is with the seller.
  await Payout.findOneAndUpdate(
    { transaction: txn._id },
    {
      $set: { status: 'completed', paidAt: new Date(now) },
      $setOnInsert: {
        seller: txn.seller,
        listing: txn.listing,
        salePrice: txn.paymentBreakdown?.subtotal || txn.itemPrice || 0,
        commissionRate: (txn.paymentBreakdown?.platformFeePercent ?? 8) / 100,
        commissionAmount: txn.paymentBreakdown?.platformFee || 0,
        payoutAmount: sellerEarnings,
      },
    },
    { upsert: true },
  );

  return { paid, reason: paid ? 'released' : 'already_released' };
};

module.exports = { releaseSellerSettlement };

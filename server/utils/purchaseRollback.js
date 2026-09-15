// Purchase rollback (compensating transactions)
// ============================================================
// A purchase is only truly complete when EVERY step succeeds: the transaction
// row, the inventory claim, the seller credit, the payout record and the
// consolidated order. If a later step throws, the earlier ones must be undone
// — otherwise the buyer's card keeps a live hold with no order, the listing
// stays depleted, the seller carries phantom pending earnings and the boost
// fee ledger charges for a sale that never happened.
//
// This helper records what each purchase path created and replays it in
// reverse on failure. It is intentionally best-effort and never throws: the
// route's original error must still be surfaced to the caller.
const Transaction = require('../models/Transaction');
const Listing = require('../models/Listing');
const Payout = require('../models/Payout');
const User = require('../models/User');
const Offer = require('../models/Offer');
const Cart = require('../models/Cart');
const { releaseAuthorization, issueRefund } = require('../config/payments');

function createPurchaseRollback() {
  const state = {
    intentId: null,
    transactionIds: [],
    inventory: [], // { listingId, qty }
    boostFees: [], // { listingId, fee }
    payoutIds: [],
    sellerCredits: [], // { sellerId, amount }
    offers: [], // { offerId, previousStatus }
    carts: [], // cartIds that must return to 'active'
  };

  const track = {
    setIntent(intentId) {
      if (intentId) state.intentId = intentId;
      return track;
    },
    addTransaction(id, intentId) {
      if (id) state.transactionIds.push(id);
      track.setIntent(intentId);
      return track;
    },
    addInventory(listingId, qty = 1) {
      if (listingId) state.inventory.push({ listingId, qty });
      return track;
    },
    addBoostFee(listingId, fee) {
      if (listingId && fee > 0) state.boostFees.push({ listingId, fee });
      return track;
    },
    addPayout(id) {
      if (id) state.payoutIds.push(id);
      return track;
    },
    // An accepted offer that was consumed by a purchase must return to
    // 'accepted' on rollback, otherwise the buyer can no longer buy at the
    // price the seller already agreed to.
    restoreOffer(offerId, previousStatus = 'accepted', transactionId = null) {
      if (offerId) state.offers.push({ offerId, previousStatus, transactionId });
      return track;
    },
    // Call ONLY after the seller credit was persisted; before that there is
    // nothing to compensate.
    addSellerCredit(sellerId, amount) {
      if (sellerId && amount) state.sellerCredits.push({ sellerId, amount });
      return track;
    },
    // A failed multi-item checkout must leave the cart usable, never stuck in
    // the terminal 'purchased' state with nothing actually bought.
    addCart(cartId) {
      if (cartId) state.carts.push(cartId);
      return track;
    },
  };

  // Release or refund whatever money the intent is holding. A 'succeeded'
  // intent has captured funds (refund); a 'requires_capture' intent is only
  // authorized (release/cancel the hold). Errors are swallowed — a failed
  // compensation must never mask the original failure, and webhook/manual
  // reconciliation can still settle an intent we could not release here.
  const releaseMoney = async () => {
    if (!state.intentId) return;
    const piState = global.__mockPaymentIntents?.[state.intentId];
    const status = piState?.status;
    if (status && ['cancelled', 'canceled', 'refunded'].includes(status)) return;
    try {
      if (status === 'succeeded') {
        await issueRefund(state.intentId);
      } else {
        const res = await releaseAuthorization(state.intentId);
        // Mock mode returns a plain object; make the released state observable
        // so callers/tests can see the hold is gone.
        if (piState && res && !['cancelled', 'canceled', 'refunded'].includes(piState.status)) {
          piState.status = 'cancelled';
        }
      }
    } catch (e) {
      console.error('Purchase rollback: could not release payment hold:', e.message);
    }
  };

  const run = async () => {
    // 1. Transactions — the order must not exist if the purchase failed.
    if (state.transactionIds.length) {
      try {
        await Transaction.deleteMany({ _id: { $in: state.transactionIds } });
      } catch (e) {
        console.error('Purchase rollback: transaction cleanup failed:', e.message);
      }
    }

    // 2. Inventory — put back the EXACT units claimed and re-list the item.
    for (const inv of state.inventory) {
      try {
        await Listing.findOneAndUpdate(
          { _id: inv.listingId },
          {
            $inc: { quantity: inv.qty, quantitySold: -inv.qty },
            $set: { sold: false, available: true },
          }
        );
      } catch (e) {
        console.error('Purchase rollback: inventory restore failed:', e.message);
      }
    }

    // 3. Boost fee ledger — no sale, no boost fee owed.
    for (const b of state.boostFees) {
      try {
        await Listing.findByIdAndUpdate(b.listingId, {
          $inc: { 'boost.feeLedger.owed': -b.fee },
        });
      } catch (e) {
        console.error('Purchase rollback: boost ledger revert failed:', e.message);
      }
    }

    // 4. Payouts — a failed purchase owes the seller no payout.
    if (state.payoutIds.length) {
      try {
        await Payout.deleteMany({ _id: { $in: state.payoutIds } });
      } catch (e) {
        console.error('Purchase rollback: payout cleanup failed:', e.message);
      }
    }

    // 4b. Offers — hand an accepted offer back to the buyer, otherwise the
    //     agreed price is silently consumed by a purchase that never happened.
    //     The restore is scoped to THIS purchase's transaction: a concurrent
    //     checkout of the same offer may have legitimately claimed it in the
    //     meantime, and a compensating action must never undo someone else's
    //     committed state.
    for (const o of state.offers) {
      try {
        const filter = { _id: o.offerId };
        if (o.transactionId) {
          filter.transaction = o.transactionId;
        } else {
          // No specific transaction known — only restore if the offer still
          // points at one of the transactions rolled back in this run.
          filter.transaction = { $in: [...state.transactionIds, null] };
        }
        await Offer.updateOne(filter, {
          $set: { status: o.previousStatus, transaction: null },
        });
      } catch (e) {
        console.error('Purchase rollback: offer restore failed:', e.message);
      }
    }

    // 4c. Carts — a checkout that did not happen must leave the cart
    //     redeemable ('active') instead of consuming it as 'purchased'.
    for (const cartId of state.carts) {
      try {
        await Cart.findOneAndUpdate(
          { _id: cartId },
          { $set: { status: 'active' } }
        );
      } catch (e) {
        console.error('Purchase rollback: cart restore failed:', e.message);
      }
    }

    // 5. Seller credits — remove phantom pending balance. Note: purchase
    //    paths credit ONLY balance.pending (never balance.totalEarned, which
    //    is incremented on release/payout), so reverting totalEarned here
    //    would corrupt the seller's lifetime earnings.
    for (const c of state.sellerCredits) {
      try {
        const seller = await User.findById(c.sellerId);
        if (!seller) continue;
        seller.balance.pending = Math.max(0, (seller.balance.pending || 0) - c.amount);
        await seller.save();
      } catch (e) {
        console.error('Purchase rollback: seller balance revert failed:', e.message);
      }
    }

    // 6. Money — last, so a DB compensation failure cannot leave the buyer
    //    charged while the rollback aborts early.
    await releaseMoney();
  };

  return {
    state,
    track,
    run,
    releaseMoney,
  };
}

module.exports = { createPurchaseRollback };
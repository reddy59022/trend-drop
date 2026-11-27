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
const Listing = require('../models/Listing');
const Payout = require('../models/Payout');
const User = require('../models/User');
const Offer = require('../models/Offer');
const Cart = require('../models/Cart');
const { releaseAuthorization, issueRefund, retrievePaymentIntent } = require('../config/payments');
const { refundShippingLabel } = require('../services/easypostService');
const { deleteTransactionsWithNotifications } = require('./transactionNotifications');

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
    labels: [], // EasyPost shipments purchased for this purchase
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
    // Platform-purchased postage must be refunded when the sale does not
    // happen. Track the provider shipment id, not the tracking number.
    addLabel(shipmentId) {
      if (shipmentId) state.labels.push(shipmentId);
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
    let status = piState?.status;
    if (!status) {
      // Real Stripe intent: a captured payment must be REFUNDED, not released.
      // Calling release on a succeeded intent fails and would leave the buyer
      // charged for a purchase this rollback just erased.
      try {
        const pi = await retrievePaymentIntent(state.intentId);
        status = pi?.status;
      } catch (e) {
        console.error('Purchase rollback: could not retrieve payment intent:', e.message);
      }
    }
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
    // 1. Transactions — remove their dependent notifications before deleting
    //    the rows. If notification cleanup fails, keep the transactions rather
    //    than creating orphaned notifications; the error is surfaced for
    //    reconciliation.
    if (state.transactionIds.length) {
      try {
        await deleteTransactionsWithNotifications(state.transactionIds);
      } catch (e) {
        console.error('Purchase rollback: transaction/notification cleanup failed:', e.message);
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
        // Atomic: a concurrent sale credit must not be lost to a
        // read-modify-write of the seller document.
        await User.updateOne({ _id: c.sellerId }, [
          {
            $set: {
              'balance.pending': {
                $max: [0, { $subtract: [{ $ifNull: ['$balance.pending', 0] }, c.amount] }],
              },
            },
          },
        ]);
      } catch (e) {
        console.error('Purchase rollback: seller balance revert failed:', e.message);
      }
    }

    // 6. Platform postage — labels are bought by TrendDrop, so a failed
    //    purchase must request a carrier refund for each label.
    for (const shipmentId of state.labels) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const result = await refundShippingLabel(shipmentId);
          if (result?.refunded !== false) break;
          console.error('Purchase rollback: shipping label refund rejected:', result?.status || 'unknown');
        } catch (e) {
          console.error('Purchase rollback: shipping label refund failed:', e.message);
        }
      }
    }

    // 7. Money — last, so a DB compensation failure cannot leave the buyer
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
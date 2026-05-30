const mongoose = require('mongoose');

const offerSchema = new mongoose.Schema({
  listing: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true,
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  status: {
    type: String,
    // Added "buyer_countered" to represent a counter-offer made by the buyer after the seller's counter.
    enum: ['pending', 'accepted', 'declined', 'countered', 'buyer_countered'],
    default: 'pending',
  },
  counterAmount: {
    type: Number,
  },
  // Store the currency of the offer to ensure multi‑currency safety. Defaults to the listing's currency on creation.
  currency: {
    type: String,
    default: 'USD',
  },
}, { timestamps: true });

// Progress checklist (for reference only)
// - [x] Add `currency` field & new status to Offer model.
// - [x] Implement buyer‑accept‑counter endpoint.
// - [x] Implement buyer‑counter endpoint.
// - [x] Refactor seller‑accept to not mark listing sold.
// - [x] Add transaction‑by‑offer endpoint.
// - [ ] Adjust payment breakdown for custom price.
// - [ ] Update ListingDetail UI to display offers/counters.
// - [x] Update OfferModal to handle currency.
// - [ ] Update Offers page for buyer actions on counters.
// - [ ] Remove/disable manual "Mark as Sold" button.
// - [ ] Add currency validation.
// - [ ] Ensure inventory decrement only on successful transaction.
// - [ ] Write unit & integration tests for negotiation flow.
// - [ ] Update README / API docs.

module.exports = mongoose.model('Offer', offerSchema);

// Task progress checklist (updated)
// - [x] Add `currency` field & new status to Offer model.
// - [x] Implement buyer‑accept‑counter endpoint.
// - [x] Implement buyer‑counter endpoint.
// - [x] Refactor seller‑accept to not mark listing sold.
// - [x] Add transaction‑by‑offer endpoint.
// - [ ] Adjust payment breakdown for custom price.
// - [ ] Update ListingDetail UI to display offers/counters.
// - [x] Update OfferModal to handle currency.
// - [ ] Update Offers page for buyer actions on counters.
// - [ ] Remove/disable manual "Mark as Sold" button.
// - [ ] Add currency validation.
// - [ ] Ensure inventory decrement only on successful transaction.
// - [ ] Write unit & integration tests for negotiation flow.
// - [ ] Update README / API docs.
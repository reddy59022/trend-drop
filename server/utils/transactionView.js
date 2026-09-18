/**
 * transactionView — canonical, VIEWER-AWARE shape for transaction money data.
 *
 * Why this exists
 * ---------------
 * `paymentBreakdown.sellerEarnings` is persisted NET of the boost fee
 * (routes/transactions.js, routes/payments.js, routes/cart.js), but the seller
 * UI never rendered that row, so the "What You Earned" column could not add up
 * (production report: $30 − $2.40 platform − $3.00 boost = $24.60 with the
 * $3.00 row missing entirely).
 *
 * This module is the single source of truth for that rendering:
 *
 *   buildSellerBreakdown()        -> self-closing seller column (seller only)
 *   sanitizeTransactionForViewer()-> role + breakdown, boost fee hidden from buyers
 *
 * Money maths lives here (server-side) so every surface — API, web, iOS,
 * Android — renders the same reconciled numbers instead of re-deriving them.
 *
 * Privacy contract
 * ----------------
 * How much a seller spends advertising a listing is seller-only data. The raw
 * ledger row is still WRITTEN to the database for every sale (the payout and
 * cancel/return reversal logic reads it back), but it is never serialised into
 * a non-seller payload.
 */

const { boostConfig } = require('../config/boost');

const CENT = 0.01; // reconciliation tolerance: sub-cent rounding is not a defect

/** Coerce anything (undefined, null, '', '12.5', Decimal128) to a finite number. */
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Round to whole cents — money is never carried at float precision. */
const round2 = (value) => Math.round(num(value) * 100) / 100;

/** ObjectId | populated ref ({_id}) | string -> string ('' when absent). */
const idOf = (ref) => {
  if (!ref) return '';
  if (typeof ref === 'object' && ref._id != null) return String(ref._id);
  return String(ref);
};

/** Human label for a boost tier, from config — never a hardcoded literal. */
const boostTierLabel = (tier) => {
  const key = String(tier || '');
  if (!key) return '';
  const config = boostConfig.tiers[key];
  return config && config.name ? config.name : 'Boost';
};

/**
 * Build the canonical seller-facing earnings column for one transaction.
 *
 * Two legitimate ledger shapes exist in this codebase and both must close:
 *   A. config/payments.js     sellerEarnings = itemPrice - platformFee (shipping excluded)
 *   B. config/shipping.js     sellerEarnings = itemPrice - platformFee + shippingPayout
 *
 * When neither explains the stored net (historic/pre-boost-era rows) the gap is
 * surfaced as `residual` instead of being silently absorbed, so the UI can still
 * balance the column and never displays a total it cannot justify.
 */
const buildSellerBreakdown = (txn) => {
  const b = (txn && txn.paymentBreakdown) || {};
  const currency = (txn && txn.currency) || 'USD';

  const itemPrice = round2(b.subtotal != null ? b.subtotal : txn && txn.itemPrice);
  const platformFee = round2(b.platformFee);
  const platformFeePercent = Number.isFinite(Number(b.platformFeePercent))
    ? Number(b.platformFeePercent)
    : null;
  const boostFee = round2(b.boostFee);
  const boostTier = String(b.boostTier || '');
  const shippingPayout = round2(b.shippingPayout);
  const sellerEarnings = round2(b.sellerEarnings);

  const shippingExcluded = round2(itemPrice - platformFee - boostFee);
  const shippingIncluded = round2(shippingExcluded + shippingPayout);

  const matchesExcluded = Math.abs(shippingExcluded - sellerEarnings) <= CENT;
  const matchesIncluded = Math.abs(shippingIncluded - sellerEarnings) <= CENT;
  const shippingIncludedInEarnings = !matchesExcluded && matchesIncluded;

  const expectedEarnings = shippingIncludedInEarnings ? shippingIncluded : shippingExcluded;
  const residual = round2(sellerEarnings - expectedEarnings);

  return {
    currency,
    itemPrice,
    platformFee,
    platformFeePercent,
    boostFee,
    boostTier,
    // Only label a boost that was actually charged — a $0 row is not a boost.
    boostTierLabel: boostFee > 0 ? boostTierLabel(boostTier) : '',
    shippingPayout,
    shippingIncludedInEarnings,
    sellerEarnings,
    expectedEarnings,
    residual,
    reconciled: Math.abs(residual) <= CENT,
  };
};

// Stored boost ledger fields that must never reach a non-seller payload.
const SELLER_ONLY_BREAKDOWN_FIELDS = ['boostFee', 'boostTier'];

/** Deep-enough clone: never mutate the caller's document (lean or hydrated). */
const toPlainTransaction = (txn) => {
  const base = txn && typeof txn.toObject === 'function' ? txn.toObject() : { ...(txn || {}) };
  if (base.paymentBreakdown && typeof base.paymentBreakdown === 'object') {
    base.paymentBreakdown = { ...base.paymentBreakdown };
  }
  return base;
};

/**
 * Decide the viewer's role from THE RECORD (never from a client-supplied hint)
 * and shape the payload accordingly:
 *   seller -> keeps the ledger row + gains `sellerBreakdown`
 *   buyer / other -> loses the seller-only boost fields
 */
const sanitizeTransactionForViewer = (txn, viewerId) => {
  const doc = toPlainTransaction(txn);
  const viewer = idOf(viewerId);

  let role = 'other';
  if (viewer) {
    if (idOf(doc.seller) === viewer) role = 'seller';
    else if (idOf(doc.buyer) === viewer) role = 'buyer';
  }
  doc.viewerRole = role;

  if (role === 'seller') {
    doc.sellerBreakdown = buildSellerBreakdown(doc);
    return doc;
  }

  delete doc.sellerBreakdown;
  if (doc.paymentBreakdown && typeof doc.paymentBreakdown === 'object') {
    for (const field of SELLER_ONLY_BREAKDOWN_FIELDS) delete doc.paymentBreakdown[field];
  }
  return doc;
};

/** Same rule, applied to a list (paginated transaction / order payloads). */
const sanitizeTransactionsForViewer = (list, viewerId) =>
  (Array.isArray(list) ? list : []).map((txn) => sanitizeTransactionForViewer(txn, viewerId));

module.exports = {
  buildSellerBreakdown,
  sanitizeTransactionForViewer,
  sanitizeTransactionsForViewer,
};
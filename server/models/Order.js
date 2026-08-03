const mongoose = require('mongoose');

// ============================================================
// Enterprise Order Model
// One Order = one buyer checkout event (can span multiple sellers).
// Sellers get separate "shipments" — each fulfilled independently —
// buyer sees one consolidated order history with role privileges.
// Money is CAPTURED and HELD at order creation; funds release to
// seller balances only via the payout lifecycle after delivery
// confirmation + return-window protection.
// ============================================================

const shipmentSchema = new mongoose.Schema({
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
  shippingCost: { type: Number, default: 0 },
  currency: { type: String, default: 'USD' },
  labelStatus: { type: String, enum: ['created', 'pending', 'failed'], default: 'created' },
  status: { type: String, enum: ['pending', 'ready', 'shipped', 'in_transit', 'delivered', 'confirmed'], default: 'pending' },
  trackingNumber: { type: String, default: '' },
  carrier: { type: String, default: '' },
  trackingUrl: { type: String, default: '' },
  shippedAt: { type: Date, default: null },
  labelUrl: { type: String, default: '' },
}, { _id: true });

const orderItemSchema = new mongoose.Schema({
  listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing', required: true },
  transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', required: true },
  seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, default: '' },
  price: { type: Number, required: true },
  quantity: { type: Number, default: 1 },
  currency: { type: String, default: 'USD' },
  image: { type: String, default: '' },
  condition: { type: String, default: '' },
  size: { type: String, default: '' },
  brand: { type: String, default: '' },
}, { _id: true });

// Client-driven allowed actions per role — "right buttons" for the UI.
function getAllowedOrderActions(order, role, userId) {
  const actions = [];
  const shippedStates = ['shipped', 'in_transit', 'delivered', 'confirmed'];
  const myShipments = (order.shipments || []).filter((s) =>
    s.seller && (s.seller._id ? s.seller._id.toString() : s.seller.toString()) === userId
  );

  if (role === 'buyer') {
    actions.push('view_order', 'view_tracking', 'contact_support');
    if (order.payment && order.payment.status === 'captured' &&
        (order.shipments || []).every((s) => s.status === 'pending' || s.status === 'ready')) {
      actions.push('cancel_within_window');
    }
  } else if (role === 'seller') {
    actions.push('view_order', 'mark_dispatched');
    if (myShipments.some((s) => s.status === 'pending' || s.status === 'ready')) actions.push('ship');
    if (myShipments.some((s) => shippedStates.includes(s.status))) actions.push('add_tracking');
  }
  return [...new Set(actions)];
}

const orderSchema = new mongoose.Schema({
  orderNumber: { type: String, unique: true, sparse: true },
  buyer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sellers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  currency: { type: String, default: 'USD' },
  items: [orderItemSchema],
  shipments: [shipmentSchema],
  totals: {
    subtotal: { type: Number, default: 0 },
    shipping: { type: Number, default: 0 },
    protectionFees: { type: Number, default: 0 },
    discounts: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
  },
  payment: {
    paymentIntentId: { type: String, default: '' },
    status: { type: String, enum: ['pending', 'requires_capture', 'captured', 'refunded', 'failed'], default: 'captured' },
    currency: { type: String, default: 'USD' },
    totalHeld: { type: Number, default: 0 },
  },
  status: {
    type: String,
    enum: ['confirmed', 'partially_shipped', 'shipped', 'completed', 'cancelled', 'refunded'],
    default: 'confirmed',
  },
  confirmation: {
    sentAt: { type: Date, default: null },
    approach: { type: String, default: 'email_and_push' },
    emailSent: { type: Boolean, default: false },
    pushSent: { type: Boolean, default: false },
  },
  shippingAddress: {
    fullName: { type: String, default: '' },
    street1: { type: String, default: '' },
    street2: { type: String, default: '' },
    city: { type: String, default: '' },
    state: { type: String, default: '' },
    postalCode: { type: String, default: '' },
    country: { type: String, default: 'US' },
    phone: { type: String, default: '' },
  },
}, { timestamps: true });

function deriveStatus(shipments) {
  if (!shipments || shipments.length === 0) return 'confirmed';
  const shipped = shipments.filter((s) => ['shipped', 'in_transit', 'delivered', 'confirmed'].includes(s.status));
  if (shipped.length === 0) return 'confirmed';
  if (shipped.length === shipments.length) return 'shipped';
  return 'partially_shipped';
}

// Same-seller bundle shipping rule:
//  - All free → 0
//  - Otherwise → highest single-item shipping (one box, one label)
orderSchema.statics.calculateBundleShipping = function (items) {
  const perItemOriginal = items.reduce((sum, i) => sum + (i.shippingCost || 0), 0);
  const allFree = items.length > 0 && items.every((i) => i.freeShipping);
  const cost = allFree ? 0 : Math.max(...items.map((i) => i.shippingCost || 0));
  return {
    shippingCost: cost,
    savings: Math.round((perItemOriginal - cost) * 100) / 100,
    perItemOriginal,
    currency: items[0]?.currency || 'USD',
  };
};

orderSchema.statics.getAllowedOrderActions = getAllowedOrderActions;

orderSchema.pre('save', function (next) {
  if (!this.orderNumber) {
    this.orderNumber = `TD-${Math.floor(100000 + Math.random() * 900000)}`;
  }
  if (!this.confirmation.sentAt) this.confirmation.sentAt = new Date();
  if (this.isNew) {
    this.confirmation.approach = 'email_and_push';
    this.confirmation.emailSent = false;
    this.confirmation.pushSent = false;
  }
  this.status = deriveStatus(this.shipments || []);
  next();
});

orderSchema.index({ buyer: 1, createdAt: -1 });
orderSchema.index({ sellers: 1, createdAt: -1 });
orderSchema.index({ orderNumber: 1 });
orderSchema.index({ 'payment.paymentIntentId': 1 });

module.exports = mongoose.model('Order', orderSchema);
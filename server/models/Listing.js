const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: 150,
  },
  description: {
    type: String,
    required: true,
    maxlength: 2000,
  },
  price: {
    type: Number,
    required: true,
    min: 0,
  },
  originalPrice: {
    type: Number,
    min: 0,
  },
  currency: {
    type: String,
    default: 'USD',
  },
  images: [{
    type: String,
  }],
  videoUrl: {
    type: String,
    default: '',
  },
  category: {
    type: String,
    required: true,
    enum: ['Women', 'Men', 'Kids', 'Electronics', 'Home', 'Beauty', 'Accessories', 'Clothing'],
  },
  brand: {
    type: String,
    trim: true,
  },
  size: {
    type: String,
  },
  condition: {
    type: String,
    required: true,
    enum: ['New with tags', 'New without tags', 'Good', 'Fair', 'Poor'],
  },
  color: {
    type: String,
  },
  // Weight and shipping
  weight: {
    type: Number,
    default: 0.5,
    min: 0.1,
  },
  weightUnit: {
    type: String,
    enum: ['kg', 'lb', 'oz'],
    default: 'kg',
  },
  dimensions: {
    length: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    unit: { type: String, default: 'cm', enum: ['cm', 'in'] },
  },
  // Shipping options
  shipping: {
    domestic: { type: Boolean, default: true },
    international: { type: Boolean, default: false },
    freeShipping: { type: Boolean, default: false },
    shippingCost: { type: Number, default: 0 },
    estimatedDays: { type: String, default: '3-5' },
    carrier: { type: String, default: '' },
  },
  // Origin country (where item ships from)
  shipsFrom: {
    type: String,
    default: 'US',
  },
  // Payment breakdown (calculated on purchase)
  paymentBreakdown: {
    sellerEarnings: { type: Number, default: 0 },
    platformFee: { type: Number, default: 0 },
    platformFeePercent: { type: Number, default: 10 },
    shippingCost: { type: Number, default: 0 },
    buyerTotal: { type: Number, default: 0 },
  },
  likes: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  comments: [{
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    text: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  }],
  shares: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  // Listing status: draft (hidden), active (visible), sold (purchased)
  status: {
    type: String,
    enum: ['draft', 'active', 'sold'],
    default: 'active',
  },
  sold: {
    type: Boolean,
    default: false,
  },
  available: {
    type: Boolean,
    default: true,
  },
  // Auto-expiration: listings expire after this date
  expiresAt: {
    type: Date,
  },
  // Inventory management
  quantity: {
    type: Number,
    default: 1,
    min: 0,
  },
  quantitySold: {
    type: Number,
    default: 0,
  },
  // Reserved inventory (items in active checkout carts)
  // Prevents overselling when multiple buyers are checking out simultaneously
  reserved: {
    type: Number,
    default: 0,
    min: 0,
  },
  // Actual shipping cost (set after label purchase by seller)
  // If actual > estimated, seller pays the difference
  actualShippingCost: {
    type: Number,
    default: 0,
  },
  actualShippingCarrier: {
    type: String,
    default: '',
  },
  shippingCostPaidBy: {
    type: String,
    enum: ['seller', 'buyer', 'platform'],
    default: 'seller',
    // 'seller' = seller pays difference if actual > estimated
    // 'buyer' = buyer pays actual cost at checkout
    // 'platform' = platform covers the difference
  },
  // Boost/promotion system
  boost: {
    active: { type: Boolean, default: false },
    tier: { type: String, enum: ['standard', 'premium', 'elite', ''], default: '' },
    startDate: { type: Date },
    endDate: { type: Date },
    durationDays: { type: Number, default: 14 },
    fee: { type: Number, default: 0 },
    priorityScore: { type: Number, default: 0 },
  },
  views: {
    type: Number,
    default: 0,
  },
  featured: {
    type: Boolean,
    default: false,
  },
  // Track when offers were shared to likers
  offerSharedAt: {
    type: Date,
  },
}, { timestamps: true });

// Performance indexes
listingSchema.index({ title: 'text', brand: 'text' });
listingSchema.index({ available: 1, sold: 1, createdAt: -1 });
listingSchema.index({ available: 1, sold: 1, category: 1, price: 1 });
listingSchema.index({ seller: 1, sold: 1, createdAt: -1 });
listingSchema.index({ category: 1, available: 1, sold: 1, price: 1 });
listingSchema.index({ shipsFrom: 1 });
listingSchema.index({ currency: 1 });
listingSchema.index({ quantity: 1, available: 1 });
listingSchema.index({ 'boost.active': 1, 'boost.endDate': 1 });
listingSchema.index({ 'boost.priorityScore': -1 });

module.exports = mongoose.model('Listing', listingSchema);
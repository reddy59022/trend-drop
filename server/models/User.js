const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    minlength: 6,
  },
  // Email verification
  emailVerified: {
    type: Boolean,
    default: false,
  },
  verificationToken: {
    type: String,
    default: null,
  },
  verificationTokenExpires: {
    type: Date,
    default: null,
  },
// Google OAuth
   googleId: {
     type: String,
     default: null,
   },
   // Apple Sign-In
   appleId: {
     type: String,
     default: null,
   },
   // Facebook Login
   facebookId: {
     type: String,
     default: null,
   },
  role: {
    type: String,
    enum: ['user', 'admin', 'moderator', 'suspended'],
    default: 'user',
  },
  authProvider: {
    type: String,
    enum: ['email', 'google', 'apple', 'facebook', 'guest'],
    default: 'email',
  },
  avatar: {
    type: String,
    default: '',
  },
  bio: {
    type: String,
    default: '',
    maxlength: 500,
  },
  // Global fields
  country: {
    type: String,
    default: 'US',
    maxlength: 2,
  },
  phone: {
    type: String,
    default: '',
  },
  phoneCode: {
    type: String,
    default: '+1',
  },
  currency: {
    type: String,
    default: 'USD',
  },
  language: {
    type: String,
    default: 'en',
  },
  // Verified seller badge (Poshmark/Depop standard)
  isVerified: {
    type: Boolean,
    default: false,
  },
  // Social media links (Poshmark/Depop standard)
  socialLinks: {
    instagram: { type: String, default: '' },
    tiktok: { type: String, default: '' },
    pinterest: { type: String, default: '' },
    youtube: { type: String, default: '' },
    twitter: { type: String, default: '' },
    facebook: { type: String, default: '' },
  },
  // Seller store customization
  store: {
    banner: { type: String, default: '' },
    logo: { type: String, default: '' },
    colorTheme: { type: String, default: '' },
    tagline: { type: String, default: '', maxlength: 200 },
    returnPolicy: { type: String, default: '' },
  },
  // Shipping address
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
  // Seller onboarding tracking (v21.0)
  onboarding: {
    completed: { type: Boolean, default: false },
    currentStep: { type: Number, default: 0 },
    completedAt: { type: Date, default: null },
    steps: {
      profileSetup: { completed: { type: Boolean, default: false }, completedAt: { type: Date, default: null } },
      firstListing: { completed: { type: Boolean, default: false }, completedAt: { type: Date, default: null } },
      shippingSetup: { completed: { type: Boolean, default: false }, completedAt: { type: Date, default: null } },
      paymentSetup: { completed: { type: Boolean, default: false }, completedAt: { type: Date, default: null } },
      tipsReview: { completed: { type: Boolean, default: false }, completedAt: { type: Date, default: null } },
    },
  },
  // Seller balance / payout info
  balance: {
    available: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
    // Rolling reserve: 10% of earnings held for 60 days to protect against chargebacks
    reserve: { type: Number, default: 0 },
    // Track when each reserve amount becomes available
    reserveReleaseDate: [{
      amount: { type: Number, required: true },
      releaseDate: { type: Date, required: true },
      transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    }],
    totalPaidOut: { type: Number, default: 0 },
    currency: { type: String, default: 'USD' },
  },
  payoutMethod: {
    type: { type: String, enum: ['paypal', 'bank', 'stripe', ''], default: '' },
    paypalEmail: { type: String, default: '' },
    bankName: { type: String, default: '' },
    accountNumber: { type: String, default: '' },
    routingNumber: { type: String, default: '' },
    accountHolder: { type: String, default: '' },
  },
  // Platform stats
  stats: {
    totalSales: { type: Number, default: 0 },
    totalPurchases: { type: Number, default: 0 },
    totalListings: { type: Number, default: 0 },
    avgRating: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 },
    responseRate: { type: Number, default: 100 },
    shipTime: { type: Number, default: 3 },
    strikes: { type: Number, default: 0 },
  },
  followers: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  following: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  }],
  closetName: {
    type: String,
    default: '',
  },
  location: {
    type: String,
    default: '',
  },
  notifications: [{
    type: { type: String, enum: ['like', 'follow', 'comment', 'offer', 'sale', 'share', 'purchase', 'shipping', 'review', 'payout', 'priceDrop', 'return', 'refund', 'dispute', 'system'] },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' },
    message: String,
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } });

// Virtual 'id' field for client compatibility
userSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

// Performance indexes
userSchema.index({ email: 1 });
userSchema.index({ name: 'text' });
userSchema.index({ 'notifications.read': 1, 'notifications.createdAt': -1 });
userSchema.index({ country: 1 });

userSchema.pre('save', async function (next) {
  // Callers that already hold a bcrypt hash (e.g. verification flow copying
  // a PendingUser hash into a new User) set _skipPasswordHash to avoid
  // double-hashing.
  if (this._skipPasswordHash) return next();
  if (!this.isModified('password') || !this.password) return next();
  // Defense-in-depth: never hash an already-hashed bcrypt string.
  if (typeof this.password === 'string' && this.password.startsWith('$2')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Generate JWT token for the user (used in tests and elsewhere)
userSchema.methods.generateAuthToken = function () {
  const jwt = require('jsonwebtoken');
  const { getJwtSecret } = require('../config/security');
  // Token expiry consistent with other auth routes (30 days)
  return jwt.sign({ id: this._id }, getJwtSecret(), { expiresIn: '30d' });
};

module.exports = mongoose.model('User', userSchema);
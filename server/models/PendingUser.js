const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Schema for temporarily storing user registration data before email verification.
// Once the verification token is validated, a proper User document will be created
// and this pending entry will be removed.
const PendingUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  // Password is hashed with bcrypt before persistence (never stored in plaintext).
  password: { type: String, required: true },
  avatar: { type: String, default: '' },
  verificationToken: { type: String, required: true },
  // expiresAt drives a MongoDB TTL index so unverified registrations are
  // auto-removed 24h after creation (mirrors verificationTokenExpires).
  expiresAt: { type: Date, required: true },
  // Backwards-compatible alias used by verification lookups.
  verificationTokenExpires: { type: Date },
}, { timestamps: true });

// Hash the password whenever it is set/changed on a PendingUser document.
// The User model skips re-hashing when the pending hash is copied over
// (see User._skipPasswordHash flag), so the stored bcrypt hash is never
// double-hashed.
PendingUserSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  // Guard: never hash an already-hashed bcrypt string.
  if (typeof this.password === 'string' && this.password.startsWith('$2')) return next();
  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// Auto-expire pending users 24 hours after creation.
PendingUserSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Keep lookups fast.
PendingUserSchema.index({ verificationToken: 1 });
PendingUserSchema.index({ email: 1 });

module.exports = mongoose.model('PendingUser', PendingUserSchema);

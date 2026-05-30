const mongoose = require('mongoose');

// Schema for temporarily storing user registration data before email verification.
// Once the verification token is validated, a proper User document will be created
// and this pending entry will be removed.
const PendingUserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // Store raw password temporarily; will be hashed when creating real User
  avatar: { type: String, default: '' },
  verificationToken: { type: String, required: true },
  verificationTokenExpires: { type: Date, required: true },
}, { timestamps: true });

module.exports = mongoose.model('PendingUser', PendingUserSchema);
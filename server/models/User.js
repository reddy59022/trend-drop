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
    required: true,
    minlength: 6,
  },
  avatar: {
    type: String,
    default: 'https://res.cloudinary.com/demo/image/upload/v1342724704/default_avatar.png',
  },
  bio: {
    type: String,
    default: '',
    maxlength: 500,
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
    type: { type: String, enum: ['like', 'follow', 'comment', 'offer', 'sale', 'share'] },
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    listing: { type: mongoose.Schema.Types.ObjectId, ref: 'Listing' },
    message: String,
    read: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

// Performance: Compound indexes for common queries
userSchema.index({ email: 1 }); 
userSchema.index({ name: 'text' });
userSchema.index({ 'notifications.read': 1, 'notifications.createdAt': -1 });

userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
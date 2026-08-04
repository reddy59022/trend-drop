const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PendingUser = require('../models/PendingUser');
const upload = require('../middleware/upload');
const { auth } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../config/email');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';

// Helper: Generate JWT + user response
const generateToken = (user) => {
  return jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '30d' });
};

const userResponse = (user, token) => ({
  token,
  user: {
    _id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    bio: user.bio,
    country: user.country,
    currency: user.currency,
    language: user.language,
    phone: user.phone,
    phoneCode: user.phoneCode,
    shippingAddress: user.shippingAddress,
    balance: user.balance,
    payoutMethod: user.payoutMethod,
    stats: user.stats,
    followers: user.followers,
    following: user.following,
    closetName: user.closetName,
    location: user.location,
    emailVerified: user.emailVerified,
    authProvider: user.authProvider,
    googleId: user.googleId,
    isVerified: user.isVerified,
    socialLinks: user.socialLinks,
    store: user.store,
  },
});

// ============================================================
// POST /api/auth/register - Register with email
// Sends verification email. User cannot login until emailVerified=true
// ============================================================
router.post('/register', upload.single('avatar'), async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    let avatar = '';
    if (req.file) {
      try {
        const { cloudinary } = require('../config/cloudinary');
        const b64 = Buffer.from(req.file.buffer).toString('base64');
        const dataURI = `data:${req.file.mimetype};base64,${b64}`;
        const result = await cloudinary.uploader.upload(dataURI, {
          folder: 'trend-drop/avatars',
          transformation: [{ width: 200, height: 200, crop: 'thumb' }],
        });
        avatar = result.secure_url;
      } catch (imgErr) {
        console.error('Avatar upload error:', imgErr.message);
      }
    }

    // Create a pending user (not yet persisted to main User collection)
    const pending = await PendingUser.create({
      name,
      email: email.toLowerCase(),
      password,
      avatar,
      verificationToken,
      verificationTokenExpires,
    });

    // Send verification email (don't block on failure)
    const emailSent = await sendVerificationEmail(pending.email, pending.name, verificationToken);

    res.status(201).json({
      message: 'Registration successful! Please check your email to verify your account.',
      emailSent,
      userId: pending._id,
    });
  } catch (error) {
    console.error('Register error:', error);
    if (error.code === 11000) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/auth/verify-email - Verify email with token (API use)
// ============================================================
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'Verification token is required' });
    }
    return await handleVerification(token, res);
  } catch (error) {
    console.error('Verify email POST error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// GET /api/auth/verify-email - Verify email with token via query param (browser link)
// ============================================================
router.get('/verify-email', async (req, res) => {
  try {
    const token = req.query.token;
    if (!token) {
      return res.status(400).json({ message: 'Verification token is required' });
    }
    return await handleVerification(token, res);
  } catch (error) {
    console.error('Verify email GET error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Shared verification logic used by both POST and GET routes
async function handleVerification(token, res) {
  // Try pending user first
  const pending = await PendingUser.findOne({
    verificationToken: token,
    verificationTokenExpires: { $gt: new Date() },
  });
  if (pending) {
    const user = await User.create({
      name: pending.name,
      email: pending.email,
      password: pending.password,
      avatar: pending.avatar,
      emailVerified: true,
      authProvider: 'email',
    });
    await PendingUser.deleteOne({ _id: pending._id });
    const jwtToken = generateToken(user);
    return res.json({
      message: 'Email verified successfully! You can now login.',
      ...userResponse(user, jwtToken),
    });
  }
  // Fallback to existing users
  const user = await User.findOne({
    verificationToken: token,
    verificationTokenExpires: { $gt: new Date() },
  });
  if (!user) {
    return res.status(400).json({ message: 'Invalid or expired verification token' });
  }
  user.emailVerified = true;
  user.verificationToken = null;
  user.verificationTokenExpires = null;
  await user.save();
  const jwtToken = generateToken(user);
  return res.json({
    message: 'Email verified successfully! You can now login.',
    ...userResponse(user, jwtToken),
  });
}

// ============================================================
// POST /api/auth/resend-verification - Resend verification email
// ============================================================
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.emailVerified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    // Generate new token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = verificationToken;
    user.verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    await sendVerificationEmail(user.email, user.name, verificationToken);

    res.json({ message: 'Verification email resent. Please check your inbox.' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/auth/login - Login with email/password
// Blocks login if email not verified
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).populate('followers', 'name avatar').populate('following', 'name avatar');

    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    // Block login if email not verified (for email auth users)
    if (user.authProvider === 'email' && !user.emailVerified) {
      return res.status(403).json({
        message: 'Please verify your email before logging in. Check your inbox or request a new verification email.',
        needsVerification: true,
        email: user.email,
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = generateToken(user);
    res.json(userResponse(user, token));
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// Google OAuth - POST /api/auth/google
// Accepts Google ID token from frontend, creates/returns user
// Works on all platforms (web, iOS, Android)
// ============================================================
router.post('/google', async (req, res) => {
  try {
    const { idToken, name, email, avatar } = req.body;

    if (!idToken || !email) {
      return res.status(400).json({ message: 'Google ID token and email required' });
    }

    // Verify the Google ID token
    const { OAuth2Client } = require('google-auth-library');
    const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } catch (verifyErr) {
      console.error('Google token verification failed:', verifyErr.message);
      return res.status(401).json({ message: 'Invalid Google token' });
    }

    // Verify the email matches the token
    if (payload.email !== email) {
      return res.status(400).json({ message: 'Email mismatch in Google token' });
    }

    // Check if user exists by googleId or email
    let user = await User.findOne({
      $or: [
        { googleId: payload.sub },
        { email: email.toLowerCase() },
      ],
    });

    if (user) {
      // Link Google account to existing user if not already linked
      if (!user.googleId) {
        user.googleId = payload.sub;
        user.authProvider = 'google';
        user.emailVerified = true; // Google accounts are pre-verified
        await user.save();
      }
    } else {
      // Create new user from Google
      user = await User.create({
        name: name || payload.name,
        email: email.toLowerCase(),
        avatar: avatar || payload.picture || '',
        googleId: payload.sub,
        authProvider: 'google',
        emailVerified: true, // Google accounts are pre-verified
        password: undefined, // No password for Google users
      });
    }

    const token = generateToken(user);
    res.json(userResponse(user, token));
  } catch (error) {
    console.error('Google auth error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// Apple Sign-In - POST /api/auth/apple
// Accepts Apple identity token from frontend, creates/returns user
// ============================================================
router.post('/apple', async (req, res) => {
  try {
    const { identityToken, name, email } = req.body;

    if (!identityToken || !email) {
      return res.status(400).json({ message: 'Apple identity token and email required' });
    }

    // Apple token verification - verify JWT claims
    // In production, verify against Apple's public keys
    // For now, we validate the token format and proceed
    const jwt = require('jsonwebtoken');
    let payload;
    try {
      // Decode without verification for development
      // In production: fetch Apple's JWKS and verify
      payload = jwt.decode(identityToken);
    } catch (decodeErr) {
      return res.status(401).json({ message: 'Invalid Apple token' });
    }

    // Apple provides email only on first sign-in
    const userEmail = payload.email || email;

    // Check if user exists by appleId or email
    let user = await User.findOne({
      $or: [
        { appleId: payload.sub },
        { email: userEmail.toLowerCase() },
      ],
    });

    if (user) {
      // Link Apple account to existing user if not already linked
      if (!user.appleId) {
        user.appleId = payload.sub;
        user.authProvider = 'apple';
        user.emailVerified = true;
        await user.save();
      }
    } else {
      // Create new user from Apple
      user = await User.create({
        name: name || payload.name?.firstName || 'Apple User',
        email: userEmail.toLowerCase(),
        appleId: payload.sub,
        authProvider: 'apple',
        emailVerified: true,
      });
    }

    const token = generateToken(user);
    res.json(userResponse(user, token));
  } catch (error) {
    console.error('Apple auth error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// Facebook Login - POST /api/auth/facebook
// Accepts Facebook access token from frontend, creates/returns user
// ============================================================
router.post('/facebook', async (req, res) => {
  try {
    const { accessToken, name, email } = req.body;

    if (!accessToken || !email) {
      return res.status(400).json({ message: 'Facebook access token and email required' });
    }

    // Verify Facebook token and get user data
    // In production, call Facebook Graph API to validate
    // For now, we accept the provided data
    const userData = {
      id: `fb_${Date.now()}`, // Placeholder Facebook ID
      name: name || email.split('@')[0],
      email: email.toLowerCase(),
    };

    // Check if user exists by facebookId or email
    let user = await User.findOne({
      $or: [
        { facebookId: userData.id },
        { email: userData.email },
      ],
    });

    if (user) {
      // Link Facebook account to existing user if not already linked
      if (!user.facebookId) {
        user.facebookId = userData.id;
        user.authProvider = 'facebook';
        user.emailVerified = true;
        await user.save();
      }
    } else {
      // Create new user from Facebook
      user = await User.create({
        name: userData.name,
        email: userData.email,
        facebookId: userData.id,
        authProvider: 'facebook',
        emailVerified: true,
      });
    }

    const token = generateToken(user);
    res.json(userResponse(user, token));
  } catch (error) {
    console.error('Facebook auth error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/auth/forgot-password - Send password reset email
// ============================================================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    // Don't reveal whether user exists
    if (!user) {
      return res.json({ message: 'If an account exists, a password reset email has been sent.' });
    }

    // Generate reset token (reuse verification token field is fine, but let's use a separate approach)
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.verificationToken = resetToken;
    user.verificationTokenExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    await sendPasswordResetEmail(user.email, user.name, resetToken);

    res.json({ message: 'If an account exists, a password reset email has been sent.' });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// POST /api/auth/reset-password - Reset password with token
// ============================================================
router.post('/reset-password', async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      return res.status(400).json({ message: 'Token and new password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    const user = await User.findOne({
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    });

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }

    user.password = password;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await user.save();

    res.json({ message: 'Password reset successful. You can now login with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// GET /api/auth/me - Get current user
// ============================================================
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('followers', 'name avatar')
      .populate('following', 'name avatar');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      bio: user.bio,
      country: user.country,
      currency: user.currency,
      language: user.language,
      phone: user.phone,
      phoneCode: user.phoneCode,
      shippingAddress: user.shippingAddress,
      balance: user.balance,
      payoutMethod: user.payoutMethod,
      stats: user.stats,
      followers: user.followers,
      following: user.following,
      closetName: user.closetName,
      location: user.location,
      emailVerified: user.emailVerified,
      authProvider: user.authProvider,
      googleId: user.googleId,
      isVerified: user.isVerified,
      socialLinks: user.socialLinks,
      store: user.store,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PUT /api/auth/profile - Update profile
// ============================================================
router.put('/profile', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const allowed = ['name', 'bio', 'country', 'currency', 'language', 'phone', 'phoneCode', 'closetName', 'location', 'shippingAddress', 'isVerified'];

    allowed.forEach(field => {
      if (req.body[field] !== undefined) {
        user[field] = req.body[field];
      }
    });

    // Merge nested objects (socialLinks, store, payoutMethod) instead of replacing
    if (req.body.socialLinks && typeof req.body.socialLinks === 'object') {
      user.socialLinks = { ...(user.socialLinks || {}), ...req.body.socialLinks };
    }
    if (req.body.store && typeof req.body.store === 'object') {
      user.store = { ...(user.store || {}), ...req.body.store };
    }
    if (req.body.payoutMethod && typeof req.body.payoutMethod === 'object') {
      user.payoutMethod = { ...(user.payoutMethod || {}), ...req.body.payoutMethod };
    }

    await user.save();
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// PUT /api/auth/avatar - Update avatar
// ============================================================
router.put('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image provided' });
    }

    const { cloudinary } = require('../config/cloudinary');
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'trend-drop/avatars',
      transformation: [{ width: 200, height: 200, crop: 'thumb' }],
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { avatar: result.secure_url } },
      { new: true }
    );

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
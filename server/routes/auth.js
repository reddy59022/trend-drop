const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const PendingUser = require('../models/PendingUser');
const upload = require('../middleware/upload');
const { auth } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../config/email');
const { getJwtSecret } = require('../config/security');
const { CURRENT_VERSIONS, requiredConsentTypes } = require('../config/legal');
const LegalAcceptance = require('../models/LegalAcceptance');
const { isCountryPolicyPublished } = require('../config/legalRuntime');

// Helper: Generate JWT + user response
// Always signs with the SAME secret the auth middleware verifies with
// (config/security.js), so logins can never produce tokens that 401.
const generateToken = (user) => {
  return jwt.sign({ id: user._id }, getJwtSecret(), { expiresIn: '30d' });
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
    legalConsent: user.legalConsent,
    ageConfirmed: user.ageConfirmed,
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
    const { name, email, password, country: requestedCountry,
      termsVersion, privacyVersion, termsAccepted, privacyAccepted, ageConfirmed } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required' });
    }
    // Hostile-input guard: all three are consumed as strings below
    // (email.toLowerCase(), password.length, bcrypt hashing). A non-string
    // either throws a TypeError or silently skips the length check — both
    // surfaced as a 500.
    if (typeof name !== 'string' || typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Name, email, and password must be strings' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();
    if (!normalizedName || normalizedName.length > 50) {
      return res.status(400).json({ message: 'Name must be between 1 and 50 characters' });
    }
    // Reject malformed addresses before creating a pending account. Without
    // this, invalid emails could consume verification records forever and
    // produce undeliverable accounts.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      return res.status(400).json({ message: 'A valid email address is required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Feature 1 — market availability: only USA + European countries may
    // register. Default to 'US' when the client does not send a country.
    const country = requestedCountry ? String(requestedCountry).toUpperCase() : 'US';
    if (!(await isCountryPolicyPublished(country))) {
      return res.status(400).json({
        message: "TrendDrop isn't available in your area yet. This country is awaiting legal and operational approval.",
        code: 'REGION_NOT_SUPPORTED',
      });
    }

    const accepted = (value) => value === true || value === 'true' || value === 'on';
    if (termsVersion !== CURRENT_VERSIONS.terms || privacyVersion !== CURRENT_VERSIONS.privacy
      || !accepted(termsAccepted) || !accepted(privacyAccepted) || !accepted(ageConfirmed)) {
      return res.status(400).json({
        message: 'You must accept the current Terms of Service and Privacy Notice and confirm the age requirement.',
        code: 'LEGAL_CONSENT_REQUIRED',
        required: { termsVersion: CURRENT_VERSIONS.terms, privacyVersion: CURRENT_VERSIONS.privacy },
      });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: 'An account with this email already exists' });
    }

    // A pending (unverified) registration with this email may already exist
    // (e.g. the user registered but never clicked the link). Resend instead
    // of silently failing on the unique index.
    const existingPending = await PendingUser.findOne({ email: normalizedEmail });
    if (existingPending) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      existingPending.verificationToken = verificationToken;
      existingPending.verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      existingPending.expiresAt = existingPending.verificationTokenExpires;
      await existingPending.save();

      await sendVerificationEmail(existingPending.email, existingPending.name, verificationToken);
      return res.status(200).json({
        message: 'A verification email was already sent. We have sent you a fresh one — please check your inbox.',
        emailSent: true,
        userId: existingPending._id,
      });
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    let avatar = '';
    if (req.file) {
      try {
        const cloudConfigured = process.env.CLOUDINARY_CLOUD_NAME
          && process.env.CLOUDINARY_API_KEY
          && process.env.CLOUDINARY_API_SECRET;
        if (process.env.NODE_ENV === 'test' || !cloudConfigured) {
          avatar = `test://avatar/${Date.now()}-${req.file.originalname || 'avatar.png'}`;
        } else {
          const { cloudinary } = require('../config/cloudinary');
          const b64 = Buffer.from(req.file.buffer).toString('base64');
          const dataURI = `data:${req.file.mimetype};base64,${b64}`;
          const result = await cloudinary.uploader.upload(dataURI, {
            folder: 'trend-drop/avatars',
            transformation: [{ width: 200, height: 200, crop: 'thumb' }],
          });
          avatar = result.secure_url;
        }
      } catch (imgErr) {
        console.error('Avatar upload error:', imgErr.message);
      }
    }

    // Create a pending user (not yet persisted to main User collection)
    const pending = await PendingUser.create({
      name: normalizedName,
      email: normalizedEmail,
      password,
      avatar,
      country,
      legalConsent: {
        termsVersion: CURRENT_VERSIONS.terms,
        privacyVersion: CURRENT_VERSIONS.privacy,
        acceptedAt: new Date(),
        ageConfirmed: true,
      },
      verificationToken,
      verificationTokenExpires,
      expiresAt: verificationTokenExpires,
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
  // Hostile-input guard: `token` is matched against a String path, so a
  // non-string (a JSON object in the body, or ?token[]=1 on the GET route)
  // makes Mongoose throw a CastError -> 500. One guard here covers both the
  // POST and GET routes.
  if (typeof token !== 'string' || !token.trim()) {
    return res.status(400).json({ message: 'A valid verification token is required' });
  }
  // Try pending user first
  // Atomically claim the pending registration. Without this, two clicks on
  // the same verification link could both read the pending row and race into
  // User.create(), producing a 500 for one request and ambiguous account state.
  const pending = await PendingUser.findOneAndUpdate(
    {
      verificationToken: token,
      verificationTokenExpires: { $gt: new Date() },
    },
    {
      $set: {
        verificationToken: null,
        verificationTokenExpires: new Date(0),
      },
    },
    { new: false },
  );
  if (pending) {
    try {
      const user = await User.create({
        name: pending.name,
        email: pending.email,
        password: pending.password,
        avatar: pending.avatar,
        country: pending.country || 'US',
        legalConsent: {
          ...(pending.legalConsent || {}),
          termsVersion: pending.legalConsent?.termsVersion || CURRENT_VERSIONS.terms,
          privacyVersion: pending.legalConsent?.privacyVersion || CURRENT_VERSIONS.privacy,
          acceptedAt: pending.legalConsent?.acceptedAt || new Date(),
          country: pending.country || 'US',
        },
        ageConfirmed: pending.legalConsent?.ageConfirmed === true,
        emailVerified: true,
        authProvider: 'email',
      });
      await PendingUser.deleteOne({ _id: pending._id });
      await LegalAcceptance.create({
        user: user._id,
        country: pending.country || 'US',
        documents: [
          { type: 'terms', version: pending.legalConsent?.termsVersion || CURRENT_VERSIONS.terms },
          { type: 'privacy', version: pending.legalConsent?.privacyVersion || CURRENT_VERSIONS.privacy },
        ],
        purpose: 'account',
        acceptedAt: pending.legalConsent?.acceptedAt || new Date(),
        ipHash: '',
        userAgent: '',
      });
      const jwtToken = generateToken(user);
      return res.json({
        message: 'Email verified successfully! You can now login.',
        ...userResponse(user, jwtToken),
      });
    } catch (error) {
      // Restore the claim if account creation failed for a transient reason;
      // the user can safely retry verification instead of losing registration.
      await PendingUser.updateOne(
        { _id: pending._id },
        {
          $set: {
            verificationToken: token,
            verificationTokenExpires: pending.verificationTokenExpires,
            expiresAt: pending.expiresAt,
          },
        },
      );
      throw error;
    }
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
// Handles BOTH pending (unverified) registrations and existing users.
// ============================================================
router.post('/resend-verification', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }
    // Hostile-input guard: `.toLowerCase()` on a non-string throws a TypeError
    // -> 500.
    if (typeof email !== 'string') {
      return res.status(400).json({ message: 'A valid email address is required' });
    }

    const normalizedEmail = email.toLowerCase();

    // Pending registrations live in PendingUser until the token is used.
    const pending = await PendingUser.findOne({ email: normalizedEmail });
    if (pending) {
      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationTokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
      pending.verificationToken = verificationToken;
      pending.verificationTokenExpires = verificationTokenExpires;
      // Keep the MongoDB TTL deadline aligned with the refreshed token.
      // Otherwise a resend can issue a valid 24-hour link on a document
      // that is still scheduled for immediate deletion.
      pending.expiresAt = verificationTokenExpires;
      await pending.save();

      await sendVerificationEmail(pending.email, pending.name, verificationToken);
      return res.json({ message: 'Verification email resent. Please check your inbox.' });
    }

    const user = await User.findOne({ email: normalizedEmail });

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
    // Hostile-input guard: `.toLowerCase()` on a non-string throws a TypeError
    // -> 500. A wrong-typed credential is simply an invalid credential, so it
    // gets the same message as a bad email/password (nothing extra leaked).
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Invalid email or password' });
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
// Apple Sign-In helpers
// Verifies the identity token's cryptographic signature against
// Apple's public JWKS (https://appleid.apple.com/auth/keys) and
// checks issuer/audience claims. Without a valid signature the
// request is rejected — a client-supplied token is never trusted.
// ============================================================
async function verifyAppleIdentityToken(identityToken) {
  const crypto = require('crypto');

  // 1. Decode header to find the key id (kid) Apple signed with.
  let decodedHeader;
  try {
    decodedHeader = jwt.decode(identityToken, { complete: true });
  } catch (err) {
    return { error: 'Invalid Apple token format' };
  }
  if (!decodedHeader || !decodedHeader.header || !decodedHeader.header.kid) {
    return { error: 'Invalid Apple token (missing key id)' };
  }

  // 2. Fetch Apple's current public keys.
  let keys;
  try {
    const res = await fetch('https://appleid.apple.com/auth/keys');
    if (!res.ok) return { error: 'Could not fetch Apple public keys' };
    const body = await res.json();
    keys = body.keys || [];
  } catch (err) {
    return { error: 'Could not fetch Apple public keys' };
  }

  // 3. Find the key that matches the token's kid.
  const jwk = keys.find((k) => k.kid === decodedHeader.header.kid);
  if (!jwk) {
    return { error: 'Apple token key not found' };
  }

  // 4. Verify the signature with the public key.
  let payload;
  try {
    const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
    const pem = publicKey.export({ type: 'spki', format: 'pem' });
    payload = jwt.verify(identityToken, pem, { algorithms: ['RS256'] });
  } catch (err) {
    return { error: 'Apple token signature verification failed' };
  }

  // 5. Validate issuer + audience claims.
  if (!payload || payload.iss !== 'https://appleid.apple.com') {
    return { error: 'Invalid Apple token issuer' };
  }
  // Audience check only when a client id is actually configured
  // (tests and local dev may sign tokens without one).
  const expectedAud = process.env.APPLE_CLIENT_ID;
  if (expectedAud && expectedAud !== 'CHANGE_ME'
    && (!payload.aud || payload.aud !== expectedAud)) {
    return { error: 'Invalid Apple token audience' };
  }
  if (!payload.sub) {
    return { error: 'Invalid Apple token (missing subject)' };
  }

  return { payload };
}

// ============================================================
// Facebook Sign-In helper
// Verifies the access token against the Facebook Graph API. The
// /me endpoint only returns data for tokens Facebook actually
// issued — a forged token fails with an OAuth error. When app
// credentials are configured we additionally use appsecret_proof.
// ============================================================
async function verifyFacebookToken(accessToken) {
  const crypto = require('crypto');
  const appSecret = process.env.FB_APP_SECRET;

  const params = new URLSearchParams({
    fields: 'id,name,email,picture',
    access_token: accessToken,
  });
  // appsecret_proof: HMAC-SHA256 of the token signed with the app secret.
  // Facebook rejects the request if the proof doesn't match, which stops
  // token-swapping attacks even if an access token leaks. Added whenever
  // app credentials are configured; /me alone still verifies the token
  // against Facebook's API (it only returns data for tokens Facebook
  // actually issued, so forged tokens fail with an OAuth error).
  if (appSecret && appSecret !== 'CHANGE_ME') {
    const proof = crypto.createHmac('sha256', appSecret).update(accessToken).digest('hex');
    params.set('appsecret_proof', proof);
  }

  let data;
  try {
    const res = await fetch(`https://graph.facebook.com/me?${params.toString()}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.error) {
      return { error: 'Invalid Facebook access token' };
    }
    data = body;
  } catch (err) {
    return { error: 'Could not verify Facebook token' };
  }

  if (!data.id || !data.email) {
    return { error: 'Facebook account is missing an email address' };
  }

  return { data };
}

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

    const { payload, error: appleError } = await verifyAppleIdentityToken(identityToken);
    if (appleError || !payload) {
      return res.status(401).json({ message: appleError || 'Invalid Apple token' });
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
        name: name || (payload.name && (payload.name.firstName || payload.name.lastName) && `${payload.name.firstName || ''} ${payload.name.lastName || ''}`.trim()) || 'Apple User',
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

    // Verify the token against the Facebook Graph API. The /me endpoint
    // only returns data for tokens Facebook actually issued, so this
    // rejects forged tokens (previous behavior accepted ANY token and
    // minted a fake facebookId — anyone could log in as anyone).
    const { data: userData, error: fbError } = await verifyFacebookToken(accessToken);
    if (fbError || !userData) {
      return res.status(401).json({ message: fbError || 'Invalid Facebook token' });
    }

    const userEmail = (userData.email || email).toLowerCase();

    // Check if user exists by facebookId or email
    let user = await User.findOne({
      $or: [
        { facebookId: userData.id },
        { email: userEmail },
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
        name: userData.name || name || userEmail.split('@')[0],
        email: userEmail,
        avatar: (userData.picture && userData.picture.data && userData.picture.data.url) || '',
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
    // Hostile-input guard: `.toLowerCase()` on a non-string throws a TypeError
    // -> 500.
    if (typeof email !== 'string') {
      return res.status(400).json({ message: 'A valid email address is required' });
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
    // Hostile-input guard: `token` is matched against a String path (a
    // non-string makes Mongoose throw a CastError -> 500) and `password` is
    // hashed by the User pre-save hook (bcrypt throws on a non-string, and
    // `password.length` on a number is undefined so the length check below
    // would silently pass).
    if (typeof token !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ message: 'Token and new password must be strings' });
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
      legalConsent: user.legalConsent,
      ageConfirmed: user.ageConfirmed,
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

    // Hostile-input guard. These values are written straight into the schema by
    // the loop below, so a wrong-typed value either throws a CastError ("Cast
    // to string failed for value ...") or stringifies into something the schema
    // then rejects on maxlength (country is max 2 chars) — both used to surface
    // as a 500. Lengths mirror models/User.js exactly.
    const STRING_FIELDS = ['name', 'bio', 'country', 'currency', 'language', 'phone', 'phoneCode', 'closetName', 'location'];
    const MAX_LENGTH = { name: 50, bio: 500, country: 2 };
    for (const field of STRING_FIELDS) {
      const value = req.body[field];
      if (value === undefined) continue;
      if (typeof value !== 'string') {
        return res.status(400).json({ message: `${field} must be a string` });
      }
      const max = MAX_LENGTH[field];
      if (max !== undefined && value.trim().length > max) {
        return res.status(400).json({ message: `${field} must be at most ${max} characters` });
      }
    }
    if (req.body.isVerified !== undefined && typeof req.body.isVerified !== 'boolean') {
      return res.status(400).json({ message: 'isVerified must be a boolean' });
    }
    if (req.body.shippingAddress !== undefined
      && (req.body.shippingAddress === null
        || typeof req.body.shippingAddress !== 'object'
        || Array.isArray(req.body.shippingAddress))) {
      return res.status(400).json({ message: 'shippingAddress must be an object' });
    }
    // Nested objects are merged (not replaced) below, so they must be plain
    // objects: spreading an array/string would write numeric keys into a typed
    // subdocument and fail casting on save.
    for (const field of ['socialLinks', 'store', 'payoutMethod']) {
      const value = req.body[field];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'object' || Array.isArray(value)) {
        return res.status(400).json({ message: `${field} must be an object` });
      }
    }

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
    const cloudConfigured = process.env.CLOUDINARY_CLOUD_NAME
      && process.env.CLOUDINARY_API_KEY
      && process.env.CLOUDINARY_API_SECRET;
    let avatarUrl;
    if (process.env.NODE_ENV === 'test' || !cloudConfigured) {
      avatarUrl = `test://avatar/${Date.now()}-${req.file.originalname || 'avatar.png'}`;
    } else {
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'trend-drop/avatars',
        transformation: [{ width: 200, height: 200, crop: 'thumb' }],
      });
      avatarUrl = result.secure_url;
    }

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: { avatar: avatarUrl } },
      { new: true }
    );

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// ============================================================
// DELETE /api/auth/account - Delete own account
// ============================================================
router.delete('/account', auth, async (req, res) => {
  try {
    const User = require('../models/User');
    const Listing = require('../models/Listing');
    const userId = req.user._id;

    // Deactivate listings instead of deleting (preserve marketplace integrity)
    await Listing.updateMany({ seller: userId }, { $set: { status: 'deleted', available: false } });
    await User.findByIdAndDelete(userId);

    res.json({ message: 'Account deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});


module.exports = router;
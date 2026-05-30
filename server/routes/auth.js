const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { auth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { currencies, getAllCurrencyCodes } = require('../config/currencies');
const { countries, getAllCountryCodes } = require('../config/countries');

// Generate JWT
const generateToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });
};

// User response helper (include all global fields)
const userResponse = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  avatar: user.avatar,
  bio: user.bio,
  country: user.country,
  phone: user.phone,
  phoneCode: user.phoneCode,
  currency: user.currency,
  language: user.language,
  shippingAddress: user.shippingAddress,
  balance: user.balance,
  payoutMethod: user.payoutMethod ? { type: user.payoutMethod.type, paypalEmail: user.payoutMethod.paypalEmail } : undefined,
  stats: user.stats,
  closetName: user.closetName,
  location: user.location,
  followers: user.followers,
  following: user.following,
});

// POST /api/auth/register
router.post('/register', upload.single('avatar'), async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { name, email, password, country, phone, phoneCode, currency, language } = req.body;

    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    const userData = { name, email, password };
    if (country) userData.country = country;
    if (phone) userData.phone = phone;
    if (phoneCode) userData.phoneCode = phoneCode;
    if (currency && getAllCurrencyCodes().includes(currency)) userData.currency = currency;
    if (language) userData.language = language;

    // Set default currency from country if not provided
    if (!currency && country) {
      const countryInfo = countries.find(c => c.code === country);
      if (countryInfo) userData.currency = countryInfo.currency;
    }

    if (req.file) {
      const { cloudinary } = require('../config/cloudinary');
      const b64 = Buffer.from(req.file.buffer).toString('base64');
      const dataURI = `data:${req.file.mimetype};base64,${b64}`;
      const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'trend-drop/avatars',
        transformation: [{ width: 200, height: 200, crop: 'fill' }],
      });
      userData.avatar = result.secure_url;
    }

    user = await User.create(userData);
    const token = generateToken(user._id);

    res.status(201).json({
      token,
      user: userResponse(user),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = generateToken(user._id);

    res.json({
      token,
      user: userResponse(user),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('-password')
      .populate('followers', 'name avatar')
      .populate('following', 'name avatar');
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/auth/profile
router.put('/profile', auth, async (req, res) => {
  try {
    const { name, bio, location, closetName, country, phone, phoneCode, currency, language, shippingAddress, payoutMethod } = req.body;
    const updateFields = {};
    if (name) updateFields.name = name;
    if (bio !== undefined) updateFields.bio = bio;
    if (location !== undefined) updateFields.location = location;
    if (closetName !== undefined) updateFields.closetName = closetName;
    if (country) updateFields.country = country;
    if (phone !== undefined) updateFields.phone = phone;
    if (phoneCode) updateFields.phoneCode = phoneCode;
    if (currency && getAllCurrencyCodes().includes(currency)) updateFields.currency = currency;
    if (language) updateFields.language = language;
    if (shippingAddress) updateFields.shippingAddress = shippingAddress;
    if (payoutMethod) updateFields.payoutMethod = payoutMethod;

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { $set: updateFields },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/auth/avatar
router.put('/avatar', auth, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Please upload an image' });
    }

    const { cloudinary } = require('../config/cloudinary');
    const b64 = Buffer.from(req.file.buffer).toString('base64');
    const dataURI = `data:${req.file.mimetype};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataURI, {
        folder: 'trend-drop/avatars',
      transformation: [{ width: 200, height: 200, crop: 'fill' }],
    });

    const user = await User.findByIdAndUpdate(
      req.user._id,
      { avatar: result.secure_url },
      { new: true }
    ).select('-password');

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/auth/config - Get platform configuration (countries, currencies)
router.get('/config', (req, res) => {
  res.json({
    currencies: getAllCurrencyCodes().map(code => ({
      code,
      ...currencies[code],
    })),
    countries: countries.map(c => ({
      code: c.code,
      name: c.name,
      phoneCode: c.phoneCode,
      phoneFormat: c.phoneFormat,
      phoneLen: c.phoneLen,
      currency: c.currency,
      flag: c.flag,
    })),
  });
});

module.exports = router;
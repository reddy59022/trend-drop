const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const MobilePreferences = require('../models/MobilePreferences');

// GET /api/mobile/preferences - Get user's mobile preferences
router.get('/preferences', auth, async (req, res) => {
  try {
    let prefs = await MobilePreferences.findOne({ userId: req.user._id });
    if (!prefs) {
      prefs = await MobilePreferences.create({ userId: req.user._id });
    }
    res.json(prefs);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get preferences' });
  }
});

// PUT /api/mobile/preferences - Update user's mobile preferences
router.put('/preferences', auth, async (req, res) => {
  try {
    const { pushNotifications, location, quickActions, biometric } = req.body;
    
    const prefs = await MobilePreferences.findOneAndUpdate(
      { userId: req.user._id },
      { 
        pushNotifications, 
        location, 
        quickActions, 
        biometric,
        deviceInfo: req.body.deviceInfo,
      },
      { new: true, upsert: true }
    );
    
    res.json(prefs);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update preferences' });
  }
});

// GET /api/mobile/shipping-estimate - Get location-based shipping estimate
router.get('/shipping-estimate', async (req, res) => {
  try {
    const { country, weight } = req.query;
    
    // Use existing shipping config for estimates
    const { calculateShipping } = require('../config/shipping');
    
    const estimate = calculateShipping('US', country || 'US', parseFloat(weight) || 0.5);
    
    res.json({
      country: country || 'US',
      shippingCost: estimate.cost,
      estimatedDays: estimate.estimatedDays,
      zone: estimate.zone,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get shipping estimate' });
  }
});

// POST /api/mobile/push-token - Register push notification token
router.post('/push-token', auth, async (req, res) => {
  try {
    const { token, platform, deviceId } = req.body;
    
    if (!token) {
      return res.status(400).json({ message: 'Push token is required' });
    }
    
    // Update preferences with push token info (stored in deviceInfo for now)
    const prefs = await MobilePreferences.findOneAndUpdate(
      { userId: req.user._id },
      { 
        userId: req.user._id,
        deviceInfo: { platform, appVersion: req.body.appVersion, pushToken: token, deviceId },
      },
      { new: true, upsert: true }
    );
    
    res.json({ message: 'Push token registered successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to register push token' });
  }
});

// POST /api/mobile/barcode-lookup - Lookup item by barcode (for quick sell)
router.post('/barcode-lookup', auth, async (req, res) => {
  try {
    const { barcode } = req.body;
    
    if (!barcode) {
      return res.status(400).json({ message: 'Barcode is required' });
    }
    
    // In a real implementation, this would look up product info from an API
    // For now, return mock data structure
    res.json({
      found: false,
      barcode,
      suggestedCategory: null,
      suggestedBrand: null,
      suggestedTitle: null,
      message: 'Barcode lookup not connected to product database',
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to lookup barcode' });
  }
});

// GET /api/mobile/features - Get available mobile features
router.get('/features', async (req, res) => {
  try {
    res.json({
      quickSell: true,
      barcodeScan: true,
      pushNotifications: true,
      biometric: true,
      cameraUpload: true,
      supportedPlatforms: ['iOS', 'Android', 'Web'],
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get features' });
  }
});

module.exports = router;
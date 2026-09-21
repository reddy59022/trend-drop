const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const MobilePreferences = require('../models/MobilePreferences');
const pushService = require('../services/pushService');

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
    let { pushNotifications, location, quickActions, biometric, deviceInfo } = req.body;

    // Preserve the original API's shorthand flags used by older mobile clients.
    // They mean "enabled" and should be normalized before strict validation.
    if (typeof pushNotifications === 'boolean') pushNotifications = { enabled: pushNotifications };
    if (typeof biometric === 'boolean') biometric = { enabled: biometric };

    const sections = [
      ['pushNotifications', pushNotifications, {
        enabled: 'boolean', priceDrop: 'boolean', messages: 'boolean', offers: 'boolean', orderUpdates: 'boolean',
      }],
      ['location', location, { country: 'string', region: 'string', useForShipping: 'boolean' }],
      ['quickActions', quickActions, { cameraSell: 'boolean', quickMessage: 'boolean', barcodeScan: 'boolean' }],
      ['biometric', biometric, { enabled: 'boolean', type: 'biometricType' }],
      ['deviceInfo', deviceInfo, { platform: 'platform', version: 'string', appVersion: 'string' }],
    ];
    const allowedBiometricTypes = ['touch', 'face', 'none'];
    const allowedPlatforms = ['iOS', 'Android', 'Web'];

    for (const [sectionName, section, fields] of sections) {
      if (section === undefined) continue;
      if (section === null || typeof section !== 'object' || Array.isArray(section)) {
        return res.status(400).json({ message: `${sectionName} must be an object` });
      }
      for (const [field, expectedType] of Object.entries(fields)) {
        if (section[field] === undefined) continue;
        const value = section[field];
        if (expectedType === 'boolean' && typeof value !== 'boolean') {
          return res.status(400).json({ message: `${sectionName}.${field} must be a boolean` });
        }
        if (expectedType === 'string' && typeof value !== 'string') {
          return res.status(400).json({ message: `${sectionName}.${field} must be a string` });
        }
        if (expectedType === 'biometricType' && !allowedBiometricTypes.includes(value)) {
          return res.status(400).json({ message: `${sectionName}.${field} must be one of ${allowedBiometricTypes.join(', ')}` });
        }
        if (expectedType === 'platform' && !allowedPlatforms.includes(value)) {
          return res.status(400).json({ message: `${sectionName}.${field} must be one of ${allowedPlatforms.join(', ')}` });
        }
      }
    }

    const update = { userId: req.user._id };
    if (pushNotifications !== undefined) update.pushNotifications = pushNotifications;
    if (location !== undefined) update.location = location;
    if (quickActions !== undefined) update.quickActions = quickActions;
    if (biometric !== undefined) update.biometric = biometric;
    if (deviceInfo !== undefined) update.deviceInfo = deviceInfo;

    const prefs = await MobilePreferences.findOneAndUpdate(
      { userId: req.user._id },
      update,
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

// POST /api/mobile/push-token - Register push notification token (TD-2.3)
router.post('/push-token', auth, async (req, res) => {
  try {
    const { token, platform, deviceId } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Push token is required' });
    }
    // Hostile-input guard: the token is stored on a String path, so a non-string
    // (e.g. {}) threw "Cast to string failed for value ..." -> 500.
    if (typeof token !== 'string') {
      return res.status(400).json({ message: 'Push token must be a string' });
    }

    // Store the device token in the push registry (clean, multi-device).
    // MobilePreferences.deviceInfo is also kept in sync for backward
    // compatibility with the app's preferences screen.
    await pushService.registerDevice(req.user._id, {
      token,
      platform: platform || 'Android',
      deviceId: deviceId || '',
      appVersion: req.body.appVersion || '',
    });

    await MobilePreferences.findOneAndUpdate(
      { userId: req.user._id },
      {
        userId: req.user._id,
        deviceInfo: { platform, appVersion: req.body.appVersion, pushToken: token, deviceId },
      },
      { new: true, upsert: true }
    );

    res.json({ message: 'Push token registered successfully' });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Failed to register push token' });
  }
});

// DELETE /api/mobile/push-token - Unregister a push notification token (TD-2.3)
router.delete('/push-token', auth, async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ message: 'Push token is required' });
    }
    if (typeof token !== 'string') {
      return res.status(400).json({ message: 'Push token must be a string' });
    }
    await pushService.unregisterDevice(req.user._id, token);
    res.json({ message: 'Push token unregistered' });
  } catch (error) {
    if (error.status === 400) {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Failed to unregister push token' });
  }
});

// POST /api/mobile/barcode-lookup - Lookup item by barcode (for quick sell)
router.post('/barcode-lookup', auth, async (req, res) => {
  try {
    const { barcode } = req.body;
    
    if (!barcode) {
      return res.status(400).json({ message: 'Barcode is required' });
    }
    if (typeof barcode !== 'string' || !/^\d{8,32}$/.test(barcode)) {
      return res.status(400).json({ message: 'Barcode must be an 8-32 digit string' });
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
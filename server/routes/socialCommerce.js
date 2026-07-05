const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const SocialCommerce = require('../models/SocialCommerce');
const Listing = require('../models/Listing');

// GET /api/social-commerce - Get user's social commerce connections
router.get('/', auth, async (req, res) => {
  try {
    const connections = await SocialCommerce.find({ seller: req.user._id })
      .sort({ platform: 1 });
    
    res.json(connections);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch social commerce connections' });
  }
});

// GET /api/social-commerce/available - Get available platforms for connection
router.get('/available', async (req, res) => {
  try {
    res.json([
      { id: 'instagram', name: 'Instagram', icon: '📷', description: 'Connect your Instagram account to auto-post listings' },
      { id: 'tiktok', name: 'TikTok', icon: '🎵', description: 'Share products on TikTok with shoppable tags' },
      { id: 'pinterest', name: 'Pinterest', icon: '📌', description: 'Create buyable pins from your listings' },
      { id: 'snapchat', name: 'Snapchat', icon: '👻', description: 'Create AR shopping lenses' },
      { id: 'facebook', name: 'Facebook', icon: '📘', description: 'Sell on Facebook Marketplace' },
    ]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch available platforms' });
  }
});

// POST /api/social-commerce/connect - Connect a social commerce account
router.post('/connect', auth, async (req, res) => {
  try {
    const { platform, accountId, accessToken } = req.body;
    
    if (!platform || !accountId) {
      return res.status(400).json({ message: 'Platform and accountId are required' });
    }
    
    const validPlatforms = ['instagram', 'tiktok', 'pinterest', 'snapchat', 'facebook'];
    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({ message: 'Invalid platform' });
    }
    
    const connection = await SocialCommerce.findOneAndUpdate(
      { seller: req.user._id, platform },
      {
        accountId,
        accessToken,
        connectedAt: new Date(),
        isActive: true,
      },
      { upsert: true, new: true }
    );
    
    res.json(connection);
  } catch (error) {
    res.status(500).json({ message: 'Failed to connect social commerce account' });
  }
});

// POST /api/social-commerce/:id/sync - Sync listings to social platform
router.post('/:id/sync', auth, async (req, res) => {
  try {
    const connection = await SocialCommerce.findOne({ _id: req.params.id, seller: req.user._id });
    if (!connection) {
      return res.status(404).json({ message: 'Connection not found' });
    }
    
    // Get active listings for this seller
    const listings = await Listing.find({ seller: req.user._id, status: 'active' }).limit(10);
    
    // Simulate sync - in production this would call platform APIs
    connection.lastSync = new Date();
    connection.stats.totalPosts += listings.length;
    connection.stats.totalViews += listings.length * 10; // Simulated
    connection.stats.totalClicks += listings.length * 2; // Simulated
    
    await connection.save();
    
    res.json({
      message: 'Sync completed',
      synced: listings.length,
      stats: connection.stats,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to sync listings' });
  }
});

// PUT /api/social-commerce/:id/settings - Update social commerce settings
router.put('/:id/settings', auth, async (req, res) => {
  try {
    const connection = await SocialCommerce.findOne({ _id: req.params.id, seller: req.user._id });
    if (!connection) {
      return res.status(404).json({ message: 'Connection not found' });
    }
    
    const { autoPostListings, autoPostSales, syncFrequency } = req.body;
    
    if (autoPostListings !== undefined) connection.settings.autoPostListings = autoPostListings;
    if (autoPostSales !== undefined) connection.settings.autoPostSales = autoPostSales;
    if (syncFrequency) connection.settings.syncFrequency = syncFrequency;
    
    await connection.save();
    
    res.json(connection);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update settings' });
  }
});

// GET /api/social-commerce/:id/stats - Get social commerce statistics
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const connection = await SocialCommerce.findOne({ _id: req.params.id, seller: req.user._id });
    if (!connection) {
      return res.status(404).json({ message: 'Connection not found' });
    }
    
    res.json(connection.stats);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch statistics' });
  }
});

// DELETE /api/social-commerce/:id - Disconnect social commerce account
router.delete('/:id', auth, async (req, res) => {
  try {
    const connection = await SocialCommerce.findOneAndDelete({ _id: req.params.id, seller: req.user._id });
    if (!connection) {
      return res.status(404).json({ message: 'Connection not found' });
    }
    
    res.json({ message: 'Connection removed' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to disconnect account' });
  }
});

module.exports = router;
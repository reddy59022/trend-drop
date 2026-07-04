const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const VirtualTryOn = require('../models/VirtualTryOn');
const Listing = require('../models/Listing');
const User = require('../models/User');

// GET /api/virtual-try-on - Get user's try-on history
router.get('/', auth, async (req, res) => {
  try {
    const tryOns = await VirtualTryOn.find({ userId: req.user._id })
      .populate('listingId', 'title images price category')
      .sort({ createdAt: -1 })
      .limit(50);
    
    res.json(tryOns);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch try-on history' });
  }
});

// GET /api/virtual-try-on/settings - Get virtual try-on feature settings
router.get('/settings', async (req, res) => {
  try {
    res.json({
      enabled: true,
      arSupported: true,
      cameraSupported: true,
      uploadSupported: true,
      supportedCategories: ['Women', 'Men', 'Kids', 'Shoes'],
      maxSizeFileSizeMB: 10,
      maxImageDimension: 2048,
      cameraResolution: { width: 1080, height: 1920 },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch settings' });
  }
});

// POST /api/virtual-try-on/session - Create a virtual try-on session
router.post('/session', auth, async (req, res) => {
  try {
    const { listingId, sessionType, measurements } = req.body;
    
    if (!listingId) {
      return res.status(400).json({ message: 'Listing ID is required' });
    }
    
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    
    // Calculate fit analysis based on measurements and listing category
    let recommendedSize = 'M';
    let confidenceScore = 75;
    let fitNotes = [];
    
    if (measurements) {
      const { bust, waist, hip } = measurements;
      const avg = (parseFloat(bust || 0) + parseFloat(waist || 0) + parseFloat(hip || 0)) / 3;
      if (avg < 34) recommendedSize = 'S';
      else if (avg > 38) recommendedSize = 'L';
      if (waist && parseFloat(waist) < 26) recommendedSize = 'XS';
      else if (waist && parseFloat(waist) > 34) {
        recommendedSize = recommendedSize === 'L' ? 'XL' : 'L';
      }
      
      fitNotes = [`Size ${recommendedSize} recommended based on your measurements`];
      if (!bust || !waist || !hip) {
        confidenceScore = 50;
        fitNotes.push('Add more measurements for better accuracy');
      }
    }
    
    // Check if session already exists
    let tryOn = await VirtualTryOn.findOne({ userId: req.user._id, listingId });
    
    if (tryOn) {
      tryOn.sessionType = sessionType || 'ar';
      tryOn.measurements = measurements || tryOn.measurements;
      tryOn.fitAnalysis = { recommendedSize, confidenceScore, fitNotes };
      tryOn.viewedAt = new Date();
      await tryOn.save();
    } else {
      tryOn = await VirtualTryOn.create({
        userId: req.user._id,
        listingId,
        sessionType: sessionType || 'ar',
        measurements,
        fitAnalysis: { recommendedSize, confidenceScore, fitNotes },
      });
    }
    
    const populated = await VirtualTryOn.findById(tryOn._id)
      .populate('listingId', 'title images price category');
    
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create try-on session' });
  }
});

// PUT /api/virtual-try-on/:id - Update try-on session (e.g., add image URL)
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { imageUrl, thumbnailUrl, durationSeconds } = req.body;
    
    const tryOn = await VirtualTryOn.findOne({ _id: id, userId: req.user._id });
    if (!tryOn) {
      return res.status(404).json({ message: 'Try-on session not found' });
    }
    
    if (imageUrl) tryOn.imageUrl = imageUrl;
    if (thumbnailUrl) tryOn.thumbnailUrl = thumbnailUrl;
    if (durationSeconds) tryOn.durationSeconds = durationSeconds;
    
    await tryOn.save();
    
    const updated = await VirtualTryOn.findById(tryOn._id)
      .populate('listingId', 'title images price category');
    
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update try-on session' });
  }
});

// DELETE /api/virtual-try-on/:id - Delete a try-on session
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const tryOn = await VirtualTryOn.findOneAndDelete({ _id: id, userId: req.user._id });
    if (!tryOn) {
      return res.status(404).json({ message: 'Try-on session not found' });
    }
    
    res.json({ message: 'Try-on session deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete try-on session' });
  }
});

// GET /api/virtual-try-on/:listingId - Get try-on session for a specific listing
router.get('/:listingId', auth, async (req, res) => {
  try {
    const { listingId } = req.params;
    
    const tryOn = await VirtualTryOn.findOne({ userId: req.user._id, listingId })
      .populate('listingId', 'title images price category');
    
    if (!tryOn) {
      return res.status(404).json({ message: 'No try-on session found for this listing' });
    }
    
    res.json(tryOn);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch try-on session' });
  }
});

module.exports = router;
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Party = require('../models/Party');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');

// GET /api/parties - List active/scheduled parties with pagination
router.get('/', async (req, res) => {
  try {
    const { category, page = 1, limit = 20 } = req.query;
    const now = new Date();
    
    let query = { status: { $in: ['scheduled', 'active'] } };
    if (category) {
      query.category = category;
    }
    
    const parties = await Party.find(query)
      .sort({ startTime: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .select('hostName hostAvatar title description coverImage category startTime endTime status discountPercent participantCount shareCount isPublic createdAt');
    
    const total = await Party.countDocuments(query);
    
    res.json({
      parties,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch parties' });
  }
});

// GET /api/parties/:id - Get single party details
router.get('/:id', async (req, res) => {
  try {
    const party = await Party.findById(req.params.id)
      .populate('listingIds', 'title price images available');
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    res.json(party);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch party' });
  }
});

// POST /api/parties - Create a new party (authenticated)
router.post('/', auth, async (req, res) => {
  try {
    const {
      title, description, coverImage, category,
      startTime, endTime, discountPercent, listingIds
    } = req.body;
    
    const party = new Party({
      hostId: req.user._id,
      hostName: req.user.name,
      hostAvatar: req.user.avatar,
      title,
      description,
      coverImage,
      category,
      startTime,
      endTime,
      discountPercent,
      listingIds: listingIds || [],
    });
    
    await party.save();
    
    res.status(201).json({ party });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to create party' });
  }
});

// PUT /api/parties/:id - Update party (host only)
router.put('/:id', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    if (party.hostId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    const updates = req.body;
    Object.assign(party, updates);
    await party.save();
    
    res.json({ party });
  } catch (error) {
    res.status(400).json({ message: 'Failed to update party' });
  }
});

// POST /api/parties/:id/share - Share a party (increment share count)
router.post('/:id/share', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    party.shareCount += 1;
    await party.save();
    
    res.json({ shareCount: party.shareCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to share party' });
  }
});

// POST /api/parties/:id/join - Join a party (increment participant count)
router.post('/:id/join', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    party.participantCount += 1;
    await party.save();
    
    res.json({ participantCount: party.participantCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to join party' });
  }
});

// DELETE /api/parties/:id - Cancel a party (host only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    if (party.hostId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    party.status = 'cancelled';
    await party.save();
    
    res.json({ message: 'Party cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to cancel party' });
  }
});

module.exports = router;
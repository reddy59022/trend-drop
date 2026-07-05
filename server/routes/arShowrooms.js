const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const ARShowroom = require('../models/ARShowroom');
const Listing = require('../models/Listing');

// GET /api/ar-showrooms - List all public showrooms (with pagination)
router.get('/', async (req, res) => {
  try {
    const { roomType, page = 1, limit = 20 } = req.query;
    const query = { isPublic: true };
    
    if (roomType) query.roomType = roomType;
    
    const showrooms = await ARShowroom.find(query)
      .populate('seller', 'name avatar')
      .populate('items.listing', 'title images price')
      .sort({ viewCount: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    
    const total = await ARShowroom.countDocuments(query);
    
    res.json({
      showrooms,
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: Number(page),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch showrooms' });
  }
});

// GET /api/ar-showrooms/seller/:sellerId - Get showrooms by seller
router.get('/seller/:sellerId', async (req, res) => {
  try {
    const showrooms = await ARShowroom.find({ seller: req.params.sellerId })
      .populate('items.listing', 'title images price')
      .sort({ createdAt: -1 });
    
    res.json(showrooms);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch seller showrooms' });
  }
});

// GET /api/ar-showrooms/:id - Get single showroom details
router.get('/:id', async (req, res) => {
  try {
    const showroom = await ARShowroom.findById(req.params.id)
      .populate('seller', 'name avatar')
      .populate('items.listing', 'title images price category');
    
    if (!showroom) {
      return res.status(404).json({ message: 'Showroom not found' });
    }
    
    // Increment view count
    showroom.viewCount += 1;
    await showroom.save();
    
    res.json(showroom);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch showroom' });
  }
});

// POST /api/ar-showrooms - Create a showroom
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, roomType, dimensions, floorPlanImage, tags } = req.body;
    
    const showroom = await ARShowroom.create({
      seller: req.user._id,
      name,
      description,
      roomType: roomType || 'custom',
      dimensions: dimensions || {},
      floorPlanImage,
      tags: tags || [],
    });
    
    res.status(201).json(showroom);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create showroom' });
  }
});

// POST /api/ar-showrooms/:id/items - Add item to showroom
router.post('/:id/items', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { listingId, position, scale } = req.body;
    
    const showroom = await ARShowroom.findById(id);
    if (!showroom) {
      return res.status(404).json({ message: 'Showroom not found' });
    }
    
    // Verify ownership
    if (showroom.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to modify this showroom' });
    }
    
    // Verify listing exists
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    
    showroom.items.push({
      listing: listingId,
      position: position || { x: 0, y: 0, z: 0, rotation: 0 },
      scale: scale || { x: 1, y: 1, z: 1 },
    });
    
    await showroom.save();
    
    const updated = await ARShowroom.findById(id)
      .populate('items.listing', 'title images price');
    
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: 'Failed to add item to showroom' });
  }
});

// PUT /api/ar-showrooms/:id - Update showroom
router.put('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    
    const showroom = await ARShowroom.findOne({ _id: id, seller: req.user._id });
    if (!showroom) {
      return res.status(404).json({ message: 'Showroom not found' });
    }
    
    Object.keys(updates).forEach(key => {
      if (key !== 'seller' && key !== 'items') {
        showroom[key] = updates[key];
      }
    });
    
    await showroom.save();
    
    res.json(showroom);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update showroom' });
  }
});

// DELETE /api/ar-showrooms/:id - Delete showroom
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const showroom = await ARShowroom.findOneAndDelete({ _id: id, seller: req.user._id });
    if (!showroom) {
      return res.status(404).json({ message: 'Showroom not found' });
    }
    
    res.json({ message: 'Showroom deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete showroom' });
  }
});

// POST /api/ar-showrooms/:id/like - Like a showroom
router.post('/:id/like', auth, async (req, res) => {
  try {
    const showroom = await ARShowroom.findById(req.params.id);
    if (!showroom) {
      return res.status(404).json({ message: 'Showroom not found' });
    }
    
    showroom.likeCount += 1;
    await showroom.save();
    
    res.json({ likeCount: showroom.likeCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to like showroom' });
  }
});

module.exports = router;
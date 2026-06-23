const express = require('express');
const router = express.Router();
const Collection = require('../models/Collection');
const Listing = require('../models/Listing');
const { auth, optionalAuth } = require('../middleware/auth');

// POST /api/collections - Create collection
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, image } = req.body;
    if (!name) return res.status(400).json({ message: 'Collection name is required' });

    const count = await Collection.countDocuments({ seller: req.user._id });
    if (count >= 20) {
      return res.status(400).json({ message: 'Maximum of 20 collections allowed' });
    }

    const collection = await Collection.create({
      seller: req.user._id,
      name,
      description: description || '',
      image: image || '',
      sortOrder: count,
    });

    res.status(201).json(collection);
  } catch (error) {
    console.error('Create collection error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/collections/seller/:sellerId - Get seller's collections
router.get('/seller/:sellerId', async (req, res) => {
  try {
    const collections = await Collection.find({
      seller: req.params.sellerId,
      isActive: true,
    })
      .populate('listings', 'title price images category condition')
      .sort({ sortOrder: 1 });

    res.json(collections);
  } catch (error) {
    console.error('Get collections error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/collections/:id - Get single collection with listings
router.get('/:id', async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id)
      .populate('listings', 'title price images category condition likes')
      .populate('seller', 'name avatar closetName');

    if (!collection) return res.status(404).json({ message: 'Collection not found' });
    res.json(collection);
  } catch (error) {
    console.error('Get collection error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/collections/:id - Update collection
router.put('/:id', auth, async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);
    if (!collection) return res.status(404).json({ message: 'Collection not found' });
    if (collection.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { name, description, image, isActive, sortOrder, listings } = req.body;
    if (name !== undefined) collection.name = name;
    if (description !== undefined) collection.description = description;
    if (image !== undefined) collection.image = image;
    if (isActive !== undefined) collection.isActive = isActive;
    if (sortOrder !== undefined) collection.sortOrder = sortOrder;
    if (listings !== undefined) collection.listings = listings;

    await collection.save();
    res.json(collection);
  } catch (error) {
    console.error('Update collection error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/collections/:id/listings - Add listing to collection
router.post('/:id/listings', auth, async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);
    if (!collection) return res.status(404).json({ message: 'Collection not found' });
    if (collection.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const { listingId } = req.body;
    if (!listingId) return res.status(400).json({ message: 'Listing ID required' });

    // Verify listing belongs to seller
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(400).json({ message: 'Listing does not belong to you' });
    }

    if (!collection.listings.includes(listingId)) {
      collection.listings.push(listingId);
      await collection.save();
    }

    res.json(collection);
  } catch (error) {
    console.error('Add to collection error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/collections/:id/listings/:listingId - Remove listing from collection
router.delete('/:id/listings/:listingId', auth, async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);
    if (!collection) return res.status(404).json({ message: 'Collection not found' });
    if (collection.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    collection.listings = collection.listings.filter(
      id => id.toString() !== req.params.listingId
    );
    await collection.save();
    res.json(collection);
  } catch (error) {
    console.error('Remove from collection error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/collections/:id - Delete collection
router.delete('/:id', auth, async (req, res) => {
  try {
    const collection = await Collection.findById(req.params.id);
    if (!collection) return res.status(404).json({ message: 'Collection not found' });
    if (collection.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    await collection.deleteOne();
    res.json({ message: 'Collection deleted' });
  } catch (error) {
    console.error('Delete collection error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
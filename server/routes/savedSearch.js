const express = require('express');
const router = express.Router();
const SavedSearch = require('../models/SavedSearch');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');

// POST /api/saved-searches - Save a search
router.post('/', auth, async (req, res) => {
  try {
    const { name, query, filters, notifyFrequency, emailNotify, pushNotify } = req.body;

    // Limit saved searches per user
    const count = await SavedSearch.countDocuments({ user: req.user._id });
    if (count >= 50) {
      return res.status(400).json({ message: 'Maximum of 50 saved searches reached' });
    }

    const savedSearch = await SavedSearch.create({
      user: req.user._id,
      name: name || query || '',
      query: query || '',
      filters: filters || {},
      notifyFrequency: notifyFrequency || 'daily',
      emailNotify: emailNotify || false,
      pushNotify: pushNotify !== false,
    });

    res.status(201).json(savedSearch);
  } catch (error) {
    console.error('Save search error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/saved-searches - Get all saved searches
router.get('/', auth, async (req, res) => {
  try {
    const searches = await SavedSearch.find({ user: req.user._id })
      .sort({ createdAt: -1 });
    res.json(searches);
  } catch (error) {
    console.error('Get saved searches error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/saved-searches/:id/results - Get current results for a saved search
router.get('/:id/results', auth, async (req, res) => {
  try {
    const savedSearch = await SavedSearch.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!savedSearch) {
      return res.status(404).json({ message: 'Saved search not found' });
    }

    // Build query from saved search filters
    const query = { available: true, sold: false, quantity: { $gt: 0 } };
    const filters = savedSearch.filters || {};

    if (filters.category) query.category = filters.category;
    if (filters.brand) query.brand = { $regex: filters.brand, $options: 'i' };
    if (filters.size) query.size = filters.size;
    if (filters.condition) query.condition = filters.condition;
    if (filters.minPrice || filters.maxPrice) {
      query.price = {};
      if (filters.minPrice) query.price.$gte = Number(filters.minPrice);
      if (filters.maxPrice) query.price.$lte = Number(filters.maxPrice);
    }
    if (savedSearch.query) {
      query.$or = [
        { title: { $regex: savedSearch.query, $options: 'i' } },
        { brand: { $regex: savedSearch.query, $options: 'i' } },
        { description: { $regex: savedSearch.query, $options: 'i' } },
      ];
    }

    let sortOption = { createdAt: -1 };
    if (filters.sort === 'price_low') sortOption = { price: 1 };
    else if (filters.sort === 'price_high') sortOption = { price: -1 };
    else if (filters.sort === 'popular') sortOption = { 'likes.length': -1 };

    const listings = await Listing.find(query)
      .populate('seller', 'name avatar')
      .sort(sortOption)
      .limit(50)
      .lean();

    // Update last checked
    savedSearch.lastChecked = new Date();
    await savedSearch.save();

    res.json({ listings, total: listings.length, savedSearch });
  } catch (error) {
    console.error('Get saved search results error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/saved-searches/:id - Update saved search
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, query, filters, notifyFrequency, emailNotify, pushNotify } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (query !== undefined) updates.query = query;
    if (filters !== undefined) updates.filters = filters;
    if (notifyFrequency !== undefined) updates.notifyFrequency = notifyFrequency;
    if (emailNotify !== undefined) updates.emailNotify = emailNotify;
    if (pushNotify !== undefined) updates.pushNotify = pushNotify;

    const savedSearch = await SavedSearch.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { $set: updates },
      { new: true }
    );

    if (!savedSearch) return res.status(404).json({ message: 'Saved search not found' });
    res.json(savedSearch);
  } catch (error) {
    console.error('Update saved search error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/saved-searches/:id - Delete saved search
router.delete('/:id', auth, async (req, res) => {
  try {
    const savedSearch = await SavedSearch.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!savedSearch) return res.status(404).json({ message: 'Saved search not found' });
    res.json({ message: 'Saved search removed' });
  } catch (error) {
    console.error('Delete saved search error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
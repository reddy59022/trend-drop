const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Listing = require('../models/Listing');
const Offer = require('../models/Offer');

// GET /api/search/brands - Get popular brands autocomplete
router.get('/brands', async (req, res) => {
  try {
    const brands = await Listing.aggregate([
      { $match: { available: true, sold: false } },
      { $group: { _id: '$brand', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
      { $project: { brand: '$_id', count: 1, _id: 0 } },
    ]);
    
    res.json(brands.filter(b => b.brand));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch brands' });
  }
});

// GET /api/search/colors - Get available colors by category
router.get('/colors', async (req, res) => {
  try {
    const { category } = req.query;
    const match = { available: true, sold: false };
    if (category) match.category = category;
    
    const colors = await Listing.aggregate([
      { $match: match },
      { $group: { _id: '$color', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 30 },
      { $project: { color: '$_id', count: 1, _id: 0 } },
    ]);
    
    res.json(colors.filter(c => c.color));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch colors' });
  }
});

// GET /api/search/sizes - Get available sizes by category
router.get('/sizes', async (req, res) => {
  try {
    const { category } = req.query;
    const match = { available: true, sold: false };
    if (category) match.category = category;
    
    const sizes = await Listing.aggregate([
      { $match: match },
      { $group: { _id: '$size', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 50 },
      { $project: { size: '$_id', count: 1, _id: 0 } },
    ]);
    
    res.json(sizes.filter(s => s.size));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch sizes' });
  }
});

// POST /api/search/save - Save a search for later
router.post('/save', auth, async (req, res) => {
  try {
    const { query, filters, name } = req.body;
    
    const AdvancedSearch = require('../models/AdvancedSearch');
    const search = await AdvancedSearch.create({
      userId: req.user._id,
      query,
      filters,
      name: name || `${filters.category || 'All'} search`,
      saved: true,
    });
    
    res.json(search);
  } catch (error) {
    res.status(500).json({ message: 'Failed to save search' });
  }
});

// GET /api/search/saved - Get user's saved searches
router.get('/saved', auth, async (req, res) => {
  try {
    const AdvancedSearch = require('../models/AdvancedSearch');
    const searches = await AdvancedSearch.find({ userId: req.user._id, saved: true })
      .sort({ updatedAt: -1 });
    
    res.json(searches);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch saved searches' });
  }
});

module.exports = router;
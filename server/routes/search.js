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

    // Hostile-input guard. This handler dereferenced `filters.category` while
    // building the default name, so a missing non-object `filters` threw a
    // TypeError, and `query` is a REQUIRED String path (absent/wrong-typed query
    // was a ValidationError). Both surfaced as 500s.
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ message: 'query is required' });
    }
    if (filters !== undefined && filters !== null && (typeof filters !== 'object' || Array.isArray(filters))) {
      return res.status(400).json({ message: 'filters must be an object' });
    }
    if (name !== undefined && name !== null && typeof name !== 'string') {
      return res.status(400).json({ message: 'name must be a string' });
    }
    const safeFilters = filters || {};
    for (const field of ['category', 'brand', 'size', 'condition', 'color', 'location']) {
      const value = safeFilters[field];
      if (value !== undefined && value !== null && typeof value !== 'string') {
        return res.status(400).json({ message: `filters.${field} must be a string` });
      }
    }
    for (const field of ['minPrice', 'maxPrice']) {
      const value = safeFilters[field];
      if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
        return res.status(400).json({ message: `filters.${field} must be a number` });
      }
    }

    const AdvancedSearch = require('../models/AdvancedSearch');
    const search = await AdvancedSearch.create({
      userId: req.user._id,
      query,
      filters: safeFilters,
      name: name || `${safeFilters.category || 'All'} search`,
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
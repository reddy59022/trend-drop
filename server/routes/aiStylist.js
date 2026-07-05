const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const AIStylist = require('../models/AIStylist');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');

// GET /api/ai-stylist/preferences - Get user preferences
router.get('/preferences', auth, async (req, res) => {
  try {
    let stylist = await AIStylist.findOne({ user: req.user._id }).populate('recommendations.listing');
    if (!stylist) {
      stylist = await AIStylist.create({ user: req.user._id });
    }
    res.json(stylist.preferences || {});
  } catch (error) {
    res.status(500).json({ message: 'Failed to get preferences' });
  }
});

// PUT /api/ai-stylist/preferences - Update user preferences
router.put('/preferences', auth, async (req, res) => {
  try {
    const { preferences } = req.body;
    const stylist = await AIStylist.findOneAndUpdate(
      { user: req.user._id },
      { preferences, lastUpdated: new Date() },
      { upsert: true, new: true }
    );
    res.json(stylist.preferences);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update preferences' });
  }
});

// GET /api/ai-stylist/recommendations - Get personalized recommendations
router.get('/recommendations', auth, async (req, res) => {
  try {
    const stylist = await AIStylist.findOne({ user: req.user._id }).populate('recommendations.listing');
    if (!stylist) {
      const stylistNew = await AIStylist.create({ user: req.user._id });
      return res.json([]);
    }
    res.json(stylist.recommendations || []);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get recommendations' });
  }
});

// POST /api/ai-stylist/generate - Generate new recommendations
router.post('/generate', auth, async (req, res) => {
  try {
    let stylist = await AIStylist.findOne({ user: req.user._id });
    if (!stylist) {
      stylist = await AIStylist.create({ user: req.user._id });
    }

    // Get user's purchase history for similar item recommendations
    const transactions = await Transaction.find({ buyer: req.user._id }).populate('listing');
    const purchasedCategories = [...new Set(transactions.map(t => t.listing?.category).filter(Boolean))];
    const purchasedBrands = [...new Set(transactions.map(t => t.listing?.brand).filter(Boolean))];

    // Build query for recommendations
    const query = {
      available: true,
      sold: false,
    };

    if (stylist.preferences?.categories?.length > 0) {
      query.category = { $in: stylist.preferences.categories };
    } else if (purchasedCategories.length > 0) {
      query.category = { $in: purchasedCategories };
    }

    if (stylist.preferences?.brands?.length > 0) {
      query.brand = { $in: stylist.preferences.brands };
    }

    // Get available listings
    const allListings = await Listing.find(query).sort({ createdAt: -1 }).limit(20);
    
    // Filter trending (most likes)
    const trending = allListings.filter(l => (l.likes?.length || 0) >= 5);
    const brandMatches = purchasedBrands.length > 0 
      ? allListings.filter(l => purchasedBrands.includes(l.brand)).filter(l => !trending.find(t => t._id.equals(l._id)))
      : [];

    // Combine and score
    const recommendations = [];
    const seen = new Set();

    for (const listing of [...trending, ...brandMatches]) {
      if (!seen.has(listing._id.toString())) {
        recommendations.push({
          listing: listing._id,
          score: trending.find(t => t._id.equals(listing._id)) ? 90 : 75,
          reason: trending.find(t => t._id.equals(listing._id)) ? 'trending' : 'brand_match',
          generatedAt: new Date(),
        });
        seen.add(listing._id.toString());
      }
    }

    // If no recommendations, just use all available listings
    if (recommendations.length === 0) {
      for (const listing of allListings) {
        recommendations.push({
          listing: listing._id,
          score: 80,
          reason: 'available',
          generatedAt: new Date(),
        });
      }
    }

    await AIStylist.findOneAndUpdate(
      { user: req.user._id },
      { recommendations, lastUpdated: new Date() },
      { upsert: true }
    );

    res.json(recommendations.slice(0, 20));
  } catch (error) {
    console.error('Generate recommendations error:', error);
    res.status(500).json({ message: 'Failed to generate recommendations' });
  }
});

// POST /api/ai-stylist/outfits - Create an outfit
router.post('/outfits', auth, async (req, res) => {
  try {
    const { name, items } = req.body;
    const stylist = await AIStylist.findOne({ user: req.user._id });
    if (!stylist) {
      const stylistNew = await AIStylist.create({ user: req.user._id });
    }

    const outfit = {
      name: name || 'My Outfit',
      items: items || [],
      createdAt: new Date(),
    };

    await AIStylist.findOneAndUpdate(
      { user: req.user._id },
      { $push: { outfits: outfit } },
      { upsert: true }
    );

    res.json(outfit);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create outfit' });
  }
});

// GET /api/ai-stylist/outfits - Get user's outfits
router.get('/outfits', auth, async (req, res) => {
  try {
    const stylist = await AIStylist.findOne({ user: req.user._id }).populate('outfits.items');
    res.json(stylist?.outfits || []);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get outfits' });
  }
});

// GET /api/ai-stylist/trends - Get seasonal trends
router.get('/trends', async (req, res) => {
  try {
    const trends = await Listing.aggregate([
      { $match: { available: true, sold: false, createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: '$category', count: { $sum: 1 }, avgPrice: { $avg: '$price' } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]);
    res.json(trends);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get trends' });
  }
});

// POST /api/ai-stylist/outfit-suggestion - Get outfit suggestions
router.post('/outfit-suggestion', auth, async (req, res) => {
  try {
    const { category, color, occasion } = req.body;
    // Build query for complementary items
    const query = {
      available: true,
      sold: false,
      category: { $ne: category },
    };

    if (color) {
      query.color = color;
    }

    const items = await Listing.find(query).sort({ createdAt: -1 }).limit(6);
    res.json({ suggestions: items, confidence: items.length >= 3 ? 'high' : 'medium' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to get outfit suggestions' });
  }
});

module.exports = router;
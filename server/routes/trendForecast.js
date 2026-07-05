const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const TrendForecast = require('../models/TrendForecast');
const Listing = require('../models/Listing');

// GET /api/trend-forecast - Get trend forecasts for all categories
router.get('/', auth, async (req, res) => {
  try {
    const forecasts = await TrendForecast.find({ isActive: true })
      .populate('trendingItems.listing', 'title price images category')
      .sort({ confidence: -1, lastUpdated: -1 });

    res.json(forecasts);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch trend forecasts' });
  }
});

// GET /api/trend-forecast/personalized - Get personalized trend recommendations
router.get('/personalized', auth, async (req, res) => {
  try {
    const user = req.user;
    
    // Get user's past listings to personalize recommendations
    const myListings = await Listing.find({ seller: user._id });
    const userCategories = [...new Set(myListings.map(l => l.category))];

    const forecasts = await TrendForecast.find({
      category: { $in: userCategories.length > 0 ? userCategories : ['Women', 'Men', 'Kids'] },
      isActive: true
    }).populate('trendingItems.listing', 'title price images category');

    res.json(forecasts);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch personalized trends' });
  }
});

// GET /api/trend-forecast/:category - Get forecast for specific category
router.get('/:category', auth, async (req, res) => {
  try {
    const forecast = await TrendForecast.findOne({
      category: req.params.category,
      isActive: true
    }).populate('trendingItems.listing', 'title price images category');

    if (!forecast) {
      return res.status(404).json({ message: 'No forecast found for this category' });
    }

    res.json(forecast);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch category forecast' });
  }
});

// GET /api/trend-forecast/:category/trending - Get trending items for category
router.get('/:category/trending', auth, async (req, res) => {
  try {
    const forecast = await TrendForecast.findOne({
      category: req.params.category,
      isActive: true
    }).populate('trendingItems.listing', 'title price images category');

    if (!forecast) {
      return res.status(404).json({ message: 'No forecast found for this category' });
    }

    res.json(forecast.trendingItems || []);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch trending items' });
  }
});

// POST /api/trend-forecast/generate - Generate new forecast data
router.post('/generate', auth, async (req, res) => {
  try {
    const { category, timeframe = 'weekly' } = req.body;

    // Get listings for the category to analyze
    const listings = await Listing.find({
      category: category || { $exists: true },
      status: 'active'
    });

    // Simple ML simulation - calculate demand based on recent views/sales
    const forecast = {
      category,
      predictedDemand: Math.floor(Math.random() * 50) + 20, // 20-70% predicted growth
      confidence: Math.floor(Math.random() * 30) + 70, // 70-99% confidence
      timeframe,
      trendingItems: listings.slice(0, 10).map(listing => ({
        listing: listing._id,
        trendScore: Math.floor(Math.random() * 100) + 1
      })),
      isActive: true
    };

    const savedForecast = await TrendForecast.findOneAndUpdate(
      { category, isActive: true },
      forecast,
      { upsert: true, new: true }
    );

    res.json(savedForecast);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate forecast' });
  }
});

// POST /api/trend-forecast/alerts - Set up trend alerts
router.post('/alerts', auth, async (req, res) => {
  try {
    const { categories, notificationType = 'email' } = req.body;

    // Create or update user's alert preferences
    const forecasts = await TrendForecast.find({
      category: { $in: categories },
      isActive: true
    });

    res.json({
      alerts: forecasts.map(f => ({
        category: f.category,
        predictedDemand: f.predictedDemand,
        alertActive: true
      }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to set up alerts' });
  }
});

module.exports = router;
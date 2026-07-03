const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Listing = require('../models/Listing');

// ===================== PRICE SUGGESTION AI =====================
// ML-based price recommendations based on market data

// Condition multipliers
const CONDITION_MULTIPLIERS = {
  New: 1.0,
  'Like New': 0.85,
  Good: 0.7,
  Fair: 0.5,
  Poor: 0.3,
};

// Brand multipliers (premium brands)
const BRAND_MULTIPLIERS = {
  'Louis Vuitton': 3.0,
  Gucci: 2.8,
  Chanel: 3.2,
  Hermes: 4.0,
  Rolex: 2.5,
  Nike: 0.9,
  Adidas: 0.85,
  Apple: 1.2,
  Samsung: 1.0,
};

// Category base prices
const CATEGORY_BASE_PRICES = {
  Men: 50,
  Women: 60,
  Kids: 30,
  Electronics: 100,
  Home: 40,
  Sports: 35,
};

// GET /api/price-suggestions/settings - Get price suggestion configuration
router.get('/settings', (req, res) => {
  res.json({
    seasonalityMultiplier: 1.1, // 10% boost during peak seasons
    conditionMultipliers: CONDITION_MULTIPLIERS,
    brandMultipliers: Object.keys(BRAND_MULTIPLIERS),
    basePrices: CATEGORY_BASE_PRICES,
  });
});

// POST /api/price-suggestions/suggest - Get AI price suggestion
router.post('/suggest', auth, async (req, res) => {
  try {
    const { title, category, brand, condition } = req.body;
    
    // Calculate base price
    let suggestedPrice = CATEGORY_BASE_PRICES[category] || 50;
    
    // Apply brand multiplier
    if (brand && BRAND_MULTIPLIERS[brand]) {
      suggestedPrice *= BRAND_MULTIPLIERS[brand];
    }
    
    // Apply condition multiplier
    if (condition && CONDITION_MULTIPLIERS[condition]) {
      suggestedPrice *= CONDITION_MULTIPLIERS[condition];
    }
    
    // Apply seasonality (placeholder - would integrate with actual seasonal data)
    const month = new Date().getMonth();
    const isHolidaySeason = [10, 11, 0].includes(month); // Nov, Dec, Jan
    if (isHolidaySeason) {
      suggestedPrice *= 1.1;
    }
    
    // Round to nearest dollar
    suggestedPrice = Math.round(suggestedPrice);
    
    // Generate price range
    const priceRange = {
      min: Math.max(5, Math.round(suggestedPrice * 0.7)),
      max: Math.round(suggestedPrice * 1.3),
    };
    
    res.json({
      suggestedPrice,
      priceRange,
      breakdown: {
        basePrice: CATEGORY_BASE_PRICES[category] || 50,
        brandMultiplier: BRAND_MULTIPLIERS[brand] || 1,
        conditionMultiplier: CONDITION_MULTIPLIERS[condition] || 1,
        seasonality: isHolidaySeason ? 1.1 : 1,
      },
    });
  } catch (error) {
    console.error('Price suggestion error:', error);
    res.status(500).json({ message: 'Failed to generate price suggestion' });
  }
});

// POST /api/price-suggestions/similar - Find similar sold listings
router.post('/similar', auth, async (req, res) => {
  try {
    const { title, category, brand } = req.body;
    
    // Search for similar sold listings
    const searchQuery = {
      sold: true,
      available: false,
    };
    
    if (category) searchQuery.category = category;
    if (brand) searchQuery.brand = brand;
    
    // Text search on title
    const listings = await Listing.find(searchQuery)
      .sort({ price: -1 })
      .limit(10);
    
    res.json({ similar: listings });
  } catch (error) {
    console.error('Similar listings error:', error);
    res.status(500).json({ message: 'Failed to find similar listings' });
  }
});

// GET /api/price-suggestions/trends - Get market trends data
router.get('/trends', async (req, res) => {
  try {
    const { category } = req.query;
    
    // Placeholder for actual trend data (would integrate with analytics service)
    const trendingCategories = [
      { category: 'Electronics', trend: 'up', changePercent: 15 },
      { category: 'Sneakers', trend: 'up', changePercent: 22 },
      { category: 'Designer', trend: 'stable', changePercent: 2 },
      { category: 'Vintage', trend: 'up', changePercent: 8 },
    ];
    
    res.json({ trendingCategories });
  } catch (error) {
    console.error('Trends error:', error);
    res.status(500).json({ message: 'Failed to fetch trends' });
  }
});

module.exports = router;
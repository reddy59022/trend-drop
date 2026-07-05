const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');

// GET /api/analytics/dashboard - Get seller analytics dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    // Get transaction stats
    const transactions = await Transaction.find({ seller: req.user._id });
    
    // Get listing stats
    const listings = await Listing.find({ seller: req.user._id });
    const activeListings = listings.filter(l => l.status === 'active').length;
    const soldListings = listings.filter(l => l.status === 'sold').length;
    
    // Calculate revenue
    const totalRevenue = transactions.reduce((sum, t) => sum + (t.amount || 0), 0);
    
    // Get subscription for fee calculation
    const subscription = await Subscription.findOne({ seller: req.user._id, status: 'active' });
    const platformFee = subscription?.features?.reducedFees ? 0.05 : 0.08;
    
    const stats = {
      totalListings: listings.length,
      activeListings,
      soldListings,
      totalRevenue,
      platformFeePercent: platformFee * 100,
      netRevenue: totalRevenue * (1 - platformFee),
      totalTransactions: transactions.length,
      recentTransactions: transactions.slice(0, 5),
      inventoryForecast: Math.max(0, activeListings - soldListings),
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch analytics dashboard' });
  }
});

// GET /api/analytics/sales - Get sales analytics
router.get('/sales', auth, async (req, res) => {
  try {
    const transactions = await Transaction.find({ seller: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30);
    
    const salesData = transactions.map(t => ({
      date: t.createdAt,
      amount: t.amount,
      status: t.status,
    }));
    
    res.json(salesData);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch sales analytics' });
  }
});

// GET /api/analytics/inventory - Get inventory analytics
router.get('/inventory', auth, async (req, res) => {
  try {
    const listings = await Listing.find({ seller: req.user._id });
    
    const inventoryData = {
      total: listings.length,
      active: listings.filter(l => l.status === 'active').length,
      sold: listings.filter(l => l.status === 'sold').length,
      draft: listings.filter(l => l.status === 'draft').length,
      byCategory: {},
    };
    
    // Group by category
    listings.forEach(l => {
      inventoryData.byCategory[l.category] = (inventoryData.byCategory[l.category] || 0) + 1;
    });
    
    res.json(inventoryData);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch inventory analytics' });
  }
});

// POST /api/analytics/forecast - Get inventory forecast
router.post('/forecast', auth, async (req, res) => {
  try {
    const listings = await Listing.find({ seller: req.user._id });
    const soldItems = listings.filter(l => l.status === 'sold');
    
    // Simple forecast based on historical sales rate
    const avgDailySales = soldItems.length / 30;
    const forecast = {
      predictedSales: Math.round(avgDailySales * 7), // Next 7 days
      recommendedStock: Math.max(10, Math.round(avgDailySales * 14)),
    };
    
    res.json(forecast);
  } catch (error) {
    res.status(500).json({ message: 'Failed to generate forecast' });
  }
});

module.exports = router;
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

// ===== SellerAnalytics page endpoints (mounted at /api/users/me/analytics/*) =====
// GET /api/users/me/analytics/overview?period=7d|30d|90d|1y
router.get('/analytics/overview', auth, async (req, res) => {
  try {
    const period = req.query.period || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const transactions = await Transaction.find({ seller: req.user._id, createdAt: { $gte: since } })
      .populate('buyer', 'name')
      .sort({ createdAt: -1 });
    const listings = await Listing.find({ seller: req.user._id });

    const cancelled = ['cancelled', 'cancelled_by_buyer', 'cancelled_by_seller', 'auto_cancelled'];
    const paidTxns = transactions.filter(t => !cancelled.includes(t.status));
    const totalRevenue = paidTxns.reduce((sum, t) => sum + (t.paymentBreakdown?.sellerEarnings || t.amount || 0), 0);
    const totalSales = paidTxns.length;
    const totalViews = listings.reduce((sum, l) => sum + (l.views || 0), 0);
    const conversionRate = totalViews > 0 ? (totalSales / totalViews) * 100 : 0;

    const rated = listings.filter(l => (l.averageRating || 0) > 0);
    const avgRating = rated.length ? rated.reduce((s, l) => s + l.averageRating, 0) / rated.length : 0;
    const totalRatings = listings.reduce((s, l) => s + (l.numRatings || 0), 0);

    res.json({
      overview: {
        totalRevenue,
        totalSales,
        totalViews,
        conversionRate,
        avgRating,
        totalRatings,
        activeListings: listings.filter(l => l.status === 'active').length,
        soldListings: listings.filter(l => l.status === 'sold').length,
        recentActivity: transactions.slice(0, 5).map(t => ({
          buyer: t.buyer,
          sellerEarnings: t.paymentBreakdown?.sellerEarnings || 0,
          createdAt: t.createdAt,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch analytics overview' });
  }
});

// GET /api/users/me/analytics/revenue?period=...
router.get('/analytics/revenue', auth, async (req, res) => {
  try {
    const period = req.query.period || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const transactions = await Transaction.find({ seller: req.user._id, createdAt: { $gte: since } })
      .sort({ createdAt: 1 });

    const buckets = {};
    transactions.forEach(t => {
      const key = t.createdAt.toISOString().slice(0, 10);
      if (!buckets[key]) buckets[key] = { date: key, revenue: 0, sales: 0 };
      buckets[key].revenue += t.paymentBreakdown?.sellerEarnings || t.amount || 0;
      buckets[key].sales += 1;
    });

    res.json({ revenue: Object.values(buckets) });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch revenue data' });
  }
});

// GET /api/users/me/analytics/top-listings?period=...
router.get('/analytics/top-listings', auth, async (req, res) => {
  try {
    const period = req.query.period || '30d';
    const days = period === '7d' ? 7 : period === '90d' ? 90 : period === '1y' ? 365 : 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const top = await Transaction.aggregate([
      { $match: { seller: req.user._id, createdAt: { $gte: since } } },
      { $group: { _id: '$listing', revenue: { $sum: '$paymentBreakdown.sellerEarnings' }, sales: { $sum: 1 } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]);
    const result = [];
    for (const t of top) {
      const listing = await Listing.findById(t._id).select('title images price').lean();
      result.push({ listing, revenue: t.revenue, sales: t.sales });
    }

    res.json({ topListings: result });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch top listings' });
  }
});

module.exports = router;
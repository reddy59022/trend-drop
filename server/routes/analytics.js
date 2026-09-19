const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Subscription = require('../models/Subscription');
const { currencies } = require('../config/currencies');

// Analytics aggregates are reported in USD so a JPY/EUR sale cannot be
// mistaken for the same numeric amount of dollars. Rates are quoted per USD.
const toUsdCents = (amount, currency = 'USD') => {
  const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const rate = currencies[currency]?.rate || 1;
  return Math.round((value / rate) * 100);
};
const fromUsdCents = (cents) => Math.round(cents) / 100;

// Only settled sales are revenue. Returns, disputes, chargebacks, and every
// cancellation state are excluded so a seller cannot report money that was
// later unwound or is still at risk.
const NON_REVENUE_STATUSES = [
  'cancelled',
  'cancelled_by_buyer',
  'cancelled_by_seller',
  'auto_cancelled',
  'refunded',
  'returned',
  'disputed',
  'chargeback_open',
  'chargeback_lost',
];

// GET /api/analytics/dashboard - Get seller analytics dashboard
router.get('/dashboard', auth, async (req, res) => {
  try {
    // Get transaction stats
    const transactions = await Transaction.find({ seller: req.user._id, status: { $nin: NON_REVENUE_STATUSES } });
    
    // Get listing stats
    const listings = await Listing.find({ seller: req.user._id });
    const activeListings = listings.filter(l => l.status === 'active').length;
    const soldListings = listings.filter(l => l.status === 'sold').length;
    
    // Calculate revenue
    // `totalRevenue` is seller net earnings. It is already net of the
    // platform fee, so applying the fee a second time would under-report the
    // seller and misstate platform economics.
    const totalRevenue = fromUsdCents(transactions.reduce(
      (cents, t) => cents + toUsdCents(t.paymentBreakdown?.sellerEarnings ?? t.amount ?? 0, t.currency),
      0
    ));
    const platformRevenue = fromUsdCents(transactions.reduce(
      (cents, t) => cents + toUsdCents(t.paymentBreakdown?.platformFee ?? 0, t.currency),
      0
    ));

    // Get subscription for display/configuration compatibility.
    const subscription = await Subscription.findOne({ seller: req.user._id, status: 'active' });
    const platformFee = subscription?.features?.reducedFees ? 0.05 : 0.08;
    
    const stats = {
      totalListings: listings.length,
      activeListings,
      soldListings,
      totalRevenue,
      reportingCurrency: 'USD',
      platformFeePercent: platformFee * 100,
      // Seller earnings are already net; never subtract the platform fee twice.
      netRevenue: totalRevenue,
      platformRevenue,
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
    const transactions = await Transaction.find({ seller: req.user._id, status: { $nin: NON_REVENUE_STATUSES } })
      .sort({ createdAt: -1 })
      .limit(30);
    
    const salesData = transactions.map(t => ({
      date: t.createdAt,
      // Legacy transactions may not have `amount`; use the authoritative
      // item subtotal before falling back to the legacy field.
      amount: t.paymentBreakdown?.subtotal ?? t.itemPrice ?? t.amount ?? 0,
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

    const paidTxns = transactions.filter(t => !NON_REVENUE_STATUSES.includes(t.status));
    const totalRevenue = fromUsdCents(paidTxns.reduce(
      (cents, t) => cents + toUsdCents(t.paymentBreakdown?.sellerEarnings || t.amount || 0, t.currency),
      0
    ));
    const totalSales = paidTxns.length;
    const totalViews = listings.reduce((sum, l) => sum + (l.views || 0), 0);
    const conversionRate = totalViews > 0 ? (totalSales / totalViews) * 100 : 0;

    const rated = listings.filter(l => (l.averageRating || 0) > 0);
    const avgRating = rated.length ? rated.reduce((s, l) => s + l.averageRating, 0) / rated.length : 0;
    const totalRatings = listings.reduce((s, l) => s + (l.numRatings || 0), 0);

    res.json({
      overview: {
        totalRevenue,
        reportingCurrency: 'USD',
        totalSales,
        avgOrderValue: totalSales > 0 ? totalRevenue / totalSales : 0,
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

    const transactions = await Transaction.find({
      seller: req.user._id,
      status: { $nin: NON_REVENUE_STATUSES },
      createdAt: { $gte: since },
    }).sort({ createdAt: 1 });

    const buckets = {};
    transactions.forEach(t => {
      const key = t.createdAt.toISOString().slice(0, 10);
      if (!buckets[key]) buckets[key] = { date: key, revenue: 0, sales: 0 };
      buckets[key].revenue = fromUsdCents(
        toUsdCents(buckets[key].revenue, 'USD')
        + toUsdCents(t.paymentBreakdown?.sellerEarnings || t.amount || 0, t.currency)
      );
      buckets[key].sales += 1;
    });

    res.json({ reportingCurrency: 'USD', revenue: Object.values(buckets) });
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
      { $match: { seller: req.user._id, status: { $nin: NON_REVENUE_STATUSES }, createdAt: { $gte: since } } },
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
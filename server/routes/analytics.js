const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const Offer = require('../models/Offer');
const Rating = require('../models/Rating');

// GET /api/users/me/analytics/overview - Get seller analytics overview
router.get('/analytics/overview', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { period = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get listings stats
    const totalListings = await Listing.countDocuments({ seller: sellerId });
    const activeListings = await Listing.countDocuments({ seller: sellerId, available: true, sold: false, status: 'active' });
    const soldListings = await Listing.countDocuments({ seller: sellerId, sold: true });

    // Get transaction stats
    const transactions = await Transaction.find({
      seller: sellerId,
      createdAt: { $gte: startDate }
    });

    const totalRevenue = transactions.reduce((sum, t) => sum + (t.sellerEarnings || 0), 0);
    const totalSales = transactions.length;
    const avgOrderValue = totalSales > 0 ? totalRevenue / totalSales : 0;

    // Get views stats (from likes on listings as proxy for views)
    const listings = await Listing.find({ seller: sellerId }).select('likes createdAt');
    const totalViews = listings.reduce((sum, l) => sum + (l.likes?.length || 0), 0);

    // Get offer stats
    const offers = await Offer.find({
      seller: sellerId,
      createdAt: { $gte: startDate }
    });
    const totalOffers = offers.length;
    const acceptedOffers = offers.filter(o => o.status === 'accepted').length;
    const offerAcceptanceRate = totalOffers > 0 ? (acceptedOffers / totalOffers) * 100 : 0;

    // Get rating stats
    const ratings = await Rating.find({ seller: sellerId });
    const avgRating = ratings.length > 0 
      ? ratings.reduce((sum, r) => sum + (r.rating || 0), 0) / ratings.length 
      : 0;
    const totalRatings = ratings.length;

    // Get recent activity
    const recentTransactions = await Transaction.find({ seller: sellerId })
      .sort({ createdAt: -1 })
      .limit(5)
      .populate('buyer', 'name avatar')
      .lean();

    // Calculate conversion rate (sales / views)
    const conversionRate = totalViews > 0 ? (totalSales / totalViews) * 100 : 0;

    res.json({
      overview: {
        totalListings,
        activeListings,
        soldListings,
        totalRevenue,
        totalSales,
        avgOrderValue,
        totalViews,
        totalOffers,
        offerAcceptanceRate,
        avgRating,
        totalRatings,
        conversionRate,
      },
      recentActivity: recentTransactions,
      period,
      startDate,
      endDate: now,
    });
  } catch (error) {
    console.error('Get analytics overview error:', error);
    res.status(500).json({ message: 'Error fetching analytics' });
  }
});

// GET /api/users/me/analytics/revenue - Get revenue over time
router.get('/analytics/revenue', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { period = '30d', interval = 'day' } = req.query;

    // Calculate date range
    const now = new Date();
    let startDate;
    switch (period) {
      case '7d':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case '30d':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case '90d':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      case '1y':
        startDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const transactions = await Transaction.find({
      seller: sellerId,
      createdAt: { $gte: startDate }
    }).sort({ createdAt: 1 });

    // Group by interval
    const revenueByPeriod = {};
    transactions.forEach(t => {
      let key;
      const date = new Date(t.createdAt);
      switch (interval) {
        case 'week':
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        case 'month':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        case 'year':
          key = String(date.getFullYear());
          break;
        default: // day
          key = date.toISOString().split('T')[0];
      }
      
      if (!revenueByPeriod[key]) {
        revenueByPeriod[key] = { date: key, revenue: 0, sales: 0 };
      }
      revenueByPeriod[key].revenue += t.sellerEarnings || 0;
      revenueByPeriod[key].sales += 1;
    });

    const revenueData = Object.values(revenueByPeriod).sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      revenue: revenueData,
      period,
      interval,
      totalRevenue: transactions.reduce((sum, t) => sum + (t.sellerEarnings || 0), 0),
    });
  } catch (error) {
    console.error('Get revenue analytics error:', error);
    res.status(500).json({ message: 'Error fetching revenue analytics' });
  }
});

// GET /api/users/me/analytics/top-listings - Get top performing listings
router.get('/analytics/top-listings', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { limit = 10, period = '30d' } = req.query;

    // Calculate date range
    const now = new Date();
    const startDate = new Date(now.getTime() - parseInt(period) * 24 * 60 * 60 * 1000);

    const transactions = await Transaction.find({
      seller: sellerId,
      createdAt: { $gte: startDate }
    }).populate('listing', 'title images price');

    // Aggregate by listing
    const listingStats = {};
    transactions.forEach(t => {
      const listingId = t.listing?._id?.toString();
      if (!listingId || !t.listing) return;
      
      if (!listingStats[listingId]) {
        listingStats[listingId] = {
          listing: t.listing,
          sales: 0,
          revenue: 0,
        };
      }
      listingStats[listingId].sales += 1;
      listingStats[listingId].revenue += t.sellerEarnings || 0;
    });

    // Sort by revenue and limit
    const topListings = Object.values(listingStats)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, parseInt(limit));

    res.json({ topListings, period });
  } catch (error) {
    console.error('Get top listings error:', error);
    res.status(500).json({ message: 'Error fetching top listings' });
  }
});

// GET /api/users/me/analytics/traffic-sources - Get traffic sources (placeholder for future)
router.get('/analytics/traffic-sources', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { period = '30d' } = req.query;

    const now = new Date();
    const startDate = new Date(now.getTime() - parseInt(period) * 24 * 60 * 60 * 1000);

    // Placeholder data - in production, integrate with analytics service
    const trafficSources = [
      { source: 'Direct', visits: 0, percentage: 0 },
      { source: 'Search', visits: 0, percentage: 0 },
      { source: 'Social', visits: 0, percentage: 0 },
      { source: 'Referral', visits: 0, percentage: 0 },
    ];

    // Calculate from likes/follows as proxy
    const user = await User.findById(sellerId);
    const followerGrowth = user.followers.length;

    res.json({
      trafficSources,
      followerGrowth,
      period,
    });
  } catch (error) {
    console.error('Get traffic sources error:', error);
    res.status(500).json({ message: 'Error fetching traffic sources' });
  }
});

// GET /api/users/me/analytics/audience - Get audience demographics (placeholder)
router.get('/analytics/audience', auth, async (req, res) => {
  try {
    const sellerId = req.user._id;
    const { period = '30d' } = req.query;

    // Placeholder data - in production, integrate with analytics service
    const audience = {
      byCountry: [],
      byDevice: [
        { device: 'Mobile', percentage: 0 },
        { device: 'Desktop', percentage: 0 },
        { device: 'Tablet', percentage: 0 },
      ],
      byAge: [],
    };

    res.json({
      audience,
      period,
    });
  } catch (error) {
    console.error('Get audience error:', error);
    res.status(500).json({ message: 'Error fetching audience data' });
  }
});

module.exports = router;
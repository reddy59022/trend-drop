const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const LiveEvent = require('../models/LiveEvent');
const Listing = require('../models/Listing');

// GET /api/live-events - List all live events (with pagination)
router.get('/', async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const query = {};
    
    if (status) query.status = status;
    
    const events = await LiveEvent.find(query)
      .populate('host', 'name avatar')
      .populate('listings')
      .sort({ startTime: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));
    
    const total = await LiveEvent.countDocuments(query);
    
    res.json({
      events,
      pagination: {
        total,
        totalPages: Math.ceil(total / limit),
        currentPage: Number(page),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch live events' });
  }
});

// GET /api/live-events/upcoming - Get upcoming events for user (must be BEFORE /:id route)
router.get('/upcoming', auth, async (req, res) => {
  try {
    const events = await LiveEvent.find({
      host: req.user._id,
      startTime: { $gt: new Date() },
      status: 'scheduled',
    }).sort({ startTime: 1 });
    
    res.json(events);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch upcoming events' });
  }
});

// GET /api/live-events/stats/:hostId - Get host statistics (must be BEFORE /:id route)
router.get('/stats/:hostId', async (req, res) => {
  try {
    const events = await LiveEvent.find({ host: req.params.hostId });
    
    const stats = {
      totalEvents: events.length,
      liveEvents: events.filter(e => e.status === 'live').length,
      totalViewers: events.reduce((sum, e) => sum + (e.viewCount || 0), 0),
      totalRevenue: events.reduce((sum, e) => sum + (e.listings?.length || 0) * 100, 0), // Placeholder
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get stats' });
  }
});

// GET /api/live-events/:id - Get single event details
router.get('/:id', async (req, res) => {
  try {
    const event = await LiveEvent.findById(req.params.id)
      .populate('host', 'name avatar')
      .populate('listings')
      .populate('viewers', 'name avatar');
    
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    res.json(event);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch event' });
  }
});

// POST /api/live-events - Create a live event
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, listingIds, startTime, endTime, discount, maxViewers, thumbnail } = req.body;
    
    // Verify all listings belong to user
    const listings = await Listing.find({ _id: { $in: listingIds } });
    const allBelong = listings.every(l => l.seller.toString() === req.user._id.toString());
    
    if (!allBelong) {
      return res.status(403).json({ message: 'All listings must be yours to host' });
    }
    
    const event = await LiveEvent.create({
      host: req.user._id,
      title,
      description,
      listings: listingIds,
      startTime,
      endTime,
      discount: discount || 0,
      maxViewers: maxViewers || 100,
      thumbnail,
    });
    
    res.status(201).json(event);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create live event' });
  }
});

// POST /api/live-events/:id/join - Join a live event
router.post('/:id/join', auth, async (req, res) => {
  try {
    const event = await LiveEvent.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    if (event.viewers.length >= event.maxViewers) {
      return res.status(400).json({ message: 'Event is at max capacity' });
    }
    
    // Check if user already joined
    if (!event.viewers.includes(req.user._id)) {
      event.viewers.push(req.user._id);
      event.viewCount = (event.viewers.length || 0) + 1;
      await event.save();
    }
    
    res.json({ viewers: event.viewers.length, viewCount: event.viewCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to join event' });
  }
});

// POST /api/live-events/:id/leave - Leave a live event
router.post('/:id/leave', auth, async (req, res) => {
  try {
    const event = await LiveEvent.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    event.viewers = event.viewers.filter(v => v.toString() !== req.user._id.toString());
    await event.save();
    
    res.json({ viewers: event.viewers.length });
  } catch (error) {
    res.status(500).json({ message: 'Failed to leave event' });
  }
});

// POST /api/live-events/:id/purchase - Purchase during live event (apply discount)
router.post('/:id/purchase', auth, async (req, res) => {
  try {
    const { listingId } = req.body;
    const event = await LiveEvent.findById(req.params.id);
    
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    if (event.status !== 'live') {
      return res.status(400).json({ message: 'Event is not live' });
    }
    
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    
    // Apply discount
    const discountedPrice = listing.price * (1 - event.discount / 100);
    
    res.json({
      originalPrice: listing.price,
      discountedPrice,
      discount: event.discount,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to process purchase' });
  }
});

module.exports = router;
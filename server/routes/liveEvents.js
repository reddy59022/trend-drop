const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { auth, optionalAuth } = require('../middleware/auth');
const { asNumber, isValidObjectId } = require('../utils/validators');
const LiveEvent = require('../models/LiveEvent');
const Listing = require('../models/Listing');
const Transaction = require('../models/Transaction');
const { SALE_STATUSES } = require('../utils/sellerStats');
const { currencies } = require('../config/currencies');

// Attendee identities are private. Everyone gets a count; only the host sees
// who is in the room (the public payload used to expose populated viewers).
const forAudience = (event, user) => {
  const obj = event.toObject ? event.toObject() : { ...event };
  obj.viewerCount = Array.isArray(obj.viewers) ? obj.viewers.length : 0;
  const hostId = obj.host && obj.host._id ? String(obj.host._id) : String(obj.host);
  if (!user || hostId !== String(user._id)) {
    delete obj.viewers;
  }
  return obj;
};

// GET /api/live-events - List all live events (with pagination)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(asNumber(req.query.limit, 20) || 20, 50));
    const query = {};
    
    if (status) query.status = status;
    
    const events = await LiveEvent.find(query)
      .populate('host', 'name avatar')
      .populate('listings')
      .sort({ startTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit);
    
    const total = await LiveEvent.countDocuments(query);
    
    res.json({
      events: events.map((event) => forAudience(event, req.user)),
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
router.get('/stats/:hostId', auth, async (req, res) => {
  try {
    if (!isValidObjectId(req.params.hostId)) {
      return res.status(400).json({ message: 'Invalid host id' });
    }
    // Revenue is commercially sensitive: only the host and platform admins may
    // read it. This endpoint used to be completely public.
    if (String(req.user._id) !== String(req.params.hostId) && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view these statistics' });
    }

    const hostId = new mongoose.Types.ObjectId(req.params.hostId);
    const events = await LiveEvent.find({ host: hostId }).select('listings status viewCount').lean();

    // Revenue is realized seller earnings from settled orders for listings the
    // host featured in a live event — never a per-listing estimate. Checkout
    // does not yet persist an event reference, so listing ownership is the
    // strongest attribution available; cancelled/refunded orders are excluded.
    const listingIds = [...new Set(events.flatMap((e) => (e.listings || []).map(String)))]
      .filter((id) => isValidObjectId(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    let totalRevenue = 0;
    if (listingIds.length > 0) {
      // Group by currency and normalize to USD so a JPY sale cannot be added
      // to a USD sale as if the numbers were the same unit.
      const revenueByCurrency = await Transaction.aggregate([
        { $match: { seller: hostId, listing: { $in: listingIds }, status: { $in: SALE_STATUSES } } },
        { $group: { _id: '$currency', total: { $sum: '$paymentBreakdown.sellerEarnings' } } },
      ]);
      const usdCents = revenueByCurrency.reduce((cents, row) => {
        const rate = currencies[row._id]?.rate || 1;
        return cents + Math.round((row.total / rate) * 100);
      }, 0);
      totalRevenue = Math.round(usdCents) / 100;
    }

    const stats = {
      totalEvents: events.length,
      liveEvents: events.filter(e => e.status === 'live').length,
      totalViewers: events.reduce((sum, e) => sum + (e.viewCount || 0), 0),
      totalRevenue,
      currency: 'USD',
      reportingCurrency: 'USD',
    };
    
    res.json(stats);
  } catch (error) {
    res.status(500).json({ message: 'Failed to get stats' });
  }
});

// GET /api/live-events/:id - Get single event details
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const event = await LiveEvent.findById(req.params.id)
      .populate('host', 'name avatar')
      .populate('listings')
      .populate('viewers', 'name avatar');
    
    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }
    
    res.json(forAudience(event, req.user));
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch event' });
  }
});

// POST /api/live-events - Create a live event
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, listingIds, startTime, endTime, discount, maxViewers, thumbnail } = req.body;

    // listingIds must be valid ObjectIds — garbage strings would CastError the
    // $in lookup (500), and ghost ids would leave the event pointing at void.
    if (!Array.isArray(listingIds) || listingIds.length === 0 ||
        !listingIds.every((id) => require('mongoose').Types.ObjectId.isValid(String(id)))) {
      return res.status(400).json({ message: 'listingIds must be an array of valid listing ids' });
    }

    const trimmedTitle = typeof title === 'string' ? title.trim() : '';
    if (!trimmedTitle || trimmedTitle.length > 100) {
      return res.status(400).json({ message: 'title must be between 1 and 100 characters' });
    }

    const start = new Date(startTime);
    const end = new Date(endTime);
    if (!startTime || !endTime || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'startTime and endTime must be valid dates' });
    }
    if (end <= start) {
      return res.status(400).json({ message: 'endTime must be after startTime' });
    }

    // A discount outside 0..100 would make the live purchase quote negative.
    const discountValue = discount === undefined ? 0 : discount;
    if (typeof discountValue !== 'number' || !Number.isFinite(discountValue)
      || discountValue < 0 || discountValue > 100) {
      return res.status(400).json({ message: 'discount must be a number between 0 and 100' });
    }

    const maxViewersValue = maxViewers === undefined ? 100 : maxViewers;
    if (!Number.isInteger(maxViewersValue) || maxViewersValue < 1 || maxViewersValue > 10000) {
      return res.status(400).json({ message: 'maxViewers must be a whole number between 1 and 10000' });
    }

    // Verify all listings belong to user
    const listings = await Listing.find({ _id: { $in: listingIds } });
    const allBelong = listings.length === listingIds.length &&
      listings.every(l => l.seller.toString() === req.user._id.toString());

    if (!allBelong) {
      return res.status(403).json({ message: 'All listings must be yours to host' });
    }
    
    const event = await LiveEvent.create({
      host: req.user._id,
      title: trimmedTitle,
      description,
      listings: listingIds,
      startTime: start,
      endTime: end,
      discount: discountValue,
      maxViewers: maxViewersValue,
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

    if (['ended', 'cancelled'].includes(event.status)) {
      return res.status(400).json({ message: 'Event has ended' });
    }
    
    // Joining an event is idempotent. Check membership before capacity so a
    // reconnecting viewer is not rejected just because the room is now full.
    const alreadyJoined = event.viewers.some(viewer => viewer.toString() === req.user._id.toString());
    if (alreadyJoined) {
      return res.json({ viewers: event.viewers.length, viewCount: event.viewCount });
    }

    // Atomic join: the capacity check and membership write happen in one
    // update, so parallel requests cannot both pass the old read-then-save
    // check and overfill the room.
    const joined = await LiveEvent.findOneAndUpdate(
      {
        _id: event._id,
        status: { $in: ['scheduled', 'live'] },
        viewers: { $ne: req.user._id },
        $expr: {
          $lt: [
            { $size: '$viewers' },
            { $ifNull: ['$maxViewers', 100] },
          ],
        },
      },
      {
        $push: { viewers: req.user._id },
        // viewCount is a lifetime counter: the first viewer is 1, not 2.
        $inc: { viewCount: 1 },
      },
      { new: true },
    );

    if (joined) {
      return res.json({ viewers: joined.viewers.length, viewCount: joined.viewCount });
    }

    // The atomic claim failed: explain why using the latest state.
    const latest = await LiveEvent.findById(event._id);
    if (!latest) {
      return res.status(404).json({ message: 'Event not found' });
    }
    if (['ended', 'cancelled'].includes(latest.status)) {
      return res.status(400).json({ message: 'Event has ended' });
    }
    if (latest.viewers.some(viewer => viewer.toString() === req.user._id.toString())) {
      return res.json({ viewers: latest.viewers.length, viewCount: latest.viewCount });
    }

    return res.status(400).json({ message: 'Event is at max capacity' });
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
    if (!mongoose.Types.ObjectId.isValid(String(listingId))) {
      return res.status(400).json({ message: 'Invalid listingId' });
    }

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

    const isEventListing = event.listings.some(eventListing => eventListing.toString() === listingId.toString());
    if (!isEventListing) {
      return res.status(400).json({ message: 'Listing is not part of this event' });
    }
    
    // Apply the discount, clamped for legacy events written before creation
    // validated the 0..100 range. A negative percentage would otherwise quote
    // a negative price (and a >100 discount the same).
    const discountPercent = Math.min(100, Math.max(0, Number(event.discount) || 0));
    const discountedPrice = Math.round(
      Math.max(0, listing.price * (1 - discountPercent / 100)) * 100,
    ) / 100;
    
    res.json({
      originalPrice: listing.price,
      discountedPrice,
      discount: discountPercent,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to process purchase' });
  }
});

module.exports = router;
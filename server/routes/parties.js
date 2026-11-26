const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Party = require('../models/Party');
const Listing = require('../models/Listing');
const { auth, optionalAuth } = require('../middleware/auth');
const { asNumber } = require('../utils/validators');

// GET /api/parties - List active/scheduled parties with pagination
router.get('/', async (req, res) => {
  try {
    const { category } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(asNumber(req.query.limit, 20) || 20, 50));
    const now = new Date();
    
    let query = { status: { $in: ['scheduled', 'active'] } };
    if (category) {
      query.category = category;
    }
    
    const parties = await Party.find(query)
      .sort({ startTime: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .select('hostName hostAvatar title description coverImage category startTime endTime status discountPercent participantCount shareCount isPublic createdAt');
    
    const total = await Party.countDocuments(query);
    
    res.json({
      parties,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch parties' });
  }
});

// GET /api/parties/:id - Get single party details
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id)
      .populate('listingIds', 'title price images available');

    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }

    // A private party is visible only to its host. The list endpoint already
    // omits cancelled parties; detail must not leak hidden ones by id.
    const isHost = req.user && String(party.hostId) === String(req.user._id);
    if (party.isPublic === false && !isHost) {
      return res.status(404).json({ message: 'Party not found' });
    }

    // Attendee identities are private. Everyone sees the public count; only the
    // host sees the participant list (used to moderate the room).
    const payload = party.toObject();
    payload.participantCount = Array.isArray(payload.participants)
      ? payload.participants.length
      : payload.participantCount;
    if (!isHost) delete payload.participants;

    res.json(payload);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch party' });
  }
});

// POST /api/parties - Create a new party (authenticated)
router.post('/', auth, async (req, res) => {
  try {
    const {
      title, description, coverImage, category,
      startTime, endTime, discountPercent, listingIds, isPublic
    } = req.body;

    if (typeof title !== 'string' || !title.trim() || title.trim().length > 100) {
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

    const discountValue = discountPercent === undefined ? 10 : discountPercent;
    if (typeof discountValue !== 'number' || !Number.isFinite(discountValue)
      || discountValue < 5 || discountValue > 30) {
      return res.status(400).json({ message: 'discountPercent must be a number between 5 and 30' });
    }

    if (isPublic !== undefined && typeof isPublic !== 'boolean') {
      return res.status(400).json({ message: 'isPublic must be a boolean' });
    }

    if (listingIds !== undefined && !Array.isArray(listingIds)) {
      return res.status(400).json({ message: 'listingIds must be an array' });
    }
    const ids = listingIds || [];
    if (!ids.every(id => mongoose.Types.ObjectId.isValid(String(id)))) {
      return res.status(400).json({ message: 'listingIds must contain valid listing ids' });
    }
    if (ids.length > 0) {
      const listings = await Listing.find({ _id: { $in: ids }, seller: req.user._id }).select('_id');
      if (listings.length !== new Set(ids.map(String)).size) {
        return res.status(403).json({ message: 'All party listings must belong to you' });
      }
    }
    
    const party = new Party({
      hostId: req.user._id,
      hostName: req.user.name,
      hostAvatar: req.user.avatar,
      title: title.trim(),
      description,
      coverImage,
      category,
      startTime: start,
      endTime: end,
      discountPercent: discountValue,
      listingIds: ids,
      // Previously discarded, so every "private" party was public.
      isPublic: isPublic !== false,
    });
    
    await party.save();
    
    res.status(201).json({ party });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Failed to create party' });
  }
});

// PUT /api/parties/:id - Update party (host only)
router.put('/:id', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    if (party.hostId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    const nextStart = req.body.startTime !== undefined ? new Date(req.body.startTime) : new Date(party.startTime);
    const nextEnd = req.body.endTime !== undefined ? new Date(req.body.endTime) : new Date(party.endTime);
    if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime())) {
      return res.status(400).json({ message: 'startTime and endTime must be valid dates' });
    }
    if (nextEnd <= nextStart) {
      return res.status(400).json({ message: 'endTime must be after startTime' });
    }
    if (req.body.title !== undefined && (typeof req.body.title !== 'string' || !req.body.title.trim())) {
      return res.status(400).json({ message: 'title must not be empty' });
    }
    if (req.body.discountPercent !== undefined
      && (typeof req.body.discountPercent !== 'number'
        || req.body.discountPercent < 5 || req.body.discountPercent > 30)) {
      return res.status(400).json({ message: 'discountPercent must be a number between 5 and 30' });
    }

    const allowedFields = ['title', 'description', 'coverImage', 'category', 'discountPercent'];
    for (const field of allowedFields) {
      if (Object.prototype.hasOwnProperty.call(req.body, field)) {
        party[field] = field === 'title' ? req.body[field].trim() : req.body[field];
      }
    }
    party.startTime = nextStart;
    party.endTime = nextEnd;
    await party.save();
    
    res.json({ party });
  } catch (error) {
    res.status(400).json({ message: 'Failed to update party' });
  }
});

// POST /api/parties/:id/share - Share a party (increment share count)
router.post('/:id/share', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    party.shareCount += 1;
    await party.save();
    
    res.json({ shareCount: party.shareCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to share party' });
  }
});

// POST /api/parties/:id/join - Join a party (increment participant count)
router.post('/:id/join', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }

    const isHost = String(party.hostId) === String(req.user._id);
    if (party.isPublic === false && !isHost) {
      // Do not reveal that a private party exists.
      return res.status(404).json({ message: 'Party not found' });
    }
    if (['ended', 'cancelled'].includes(party.status)) {
      return res.status(400).json({ message: 'Party has ended' });
    }

    // Atomic unique join: only a first-time participant increments the count.
    // The previous read-modify-write incremented on every click/reconnect, so
    // one user could inflate a party's public attendance arbitrarily. The
    // status filter closes the race with a concurrent cancellation.
    const joined = await Party.findOneAndUpdate(
      {
        _id: req.params.id,
        status: { $in: ['scheduled', 'active'] },
        participants: { $ne: req.user._id },
      },
      { $addToSet: { participants: req.user._id }, $inc: { participantCount: 1 } },
      { new: true }
    );
    if (joined) {
      return res.json({ participantCount: joined.participantCount });
    }

    const latest = await Party.findById(req.params.id).select('participantCount status');
    if (!latest) {
      return res.status(404).json({ message: 'Party not found' });
    }
    if (['ended', 'cancelled'].includes(latest.status)) {
      return res.status(400).json({ message: 'Party has ended' });
    }
    // Already joined — idempotent success with the unchanged count.
    return res.json({ participantCount: latest.participantCount });
  } catch (error) {
    res.status(500).json({ message: 'Failed to join party' });
  }
});

// DELETE /api/parties/:id - Cancel a party (host only)
router.delete('/:id', auth, async (req, res) => {
  try {
    const party = await Party.findById(req.params.id);
    
    if (!party) {
      return res.status(404).json({ message: 'Party not found' });
    }
    
    if (party.hostId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    
    party.status = 'cancelled';
    await party.save();
    
    res.json({ message: 'Party cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to cancel party' });
  }
});

module.exports = router;
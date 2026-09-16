const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Listing = require('../models/Listing');
const { auth, optionalAuth } = require('../middleware/auth');

// GET /api/users/search - Search users
router.get('/search', async (req, res) => {
  try {
    const { asText, escapeRegex } = require('../utils/validators');
    // sanitizeQuery collapses hostile shapes (?q[$gt]=, ?q[]=x) to scalars,
    // but belt-and-braces: a $regex fed a non-string still CastErrors -> 500,
    // and raw metacharacters like '*' throw inside $regex -> 500.
    const q = asText(req.query.q);
    if (!q || q.length < 1) return res.json([]);
    // Performance: lean() + limit + projection
    const users = await User.find({
      name: { $regex: escapeRegex(q), $options: 'i' },
    })
      .select('name avatar bio')
      .lean()
      .limit(10);
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me - Current authenticated user (must precede /:id so the
// literal path is not captured as an :id param, which would make
// User.findById('me') throw a CastError and 500).
router.get('/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/me/listings - Get current user's listings (must precede /:id)
router.get('/me/listings', auth, async (req, res) => {
  try {
    const listings = await Listing.find({ seller: req.user._id })
      .populate('seller', 'name avatar')
      .sort({ createdAt: -1 });
    res.json({ listings });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/feed - Get feed from followed users
router.get('/feed', auth, async (req, res) => {
  try {
    const { asText, asNumber } = require('../utils/validators');
    // Coerce hostile query shapes (?page[$gt]=1, ?sort[]=x) to scalars so
    // Number({}) -> NaN never reaches .skip() (NaN skip throws -> 500).
    const page = Math.max(1, Math.min(asNumber(req.query.page, 1) || 1, 100));
    const limit = Math.max(1, Math.min(asNumber(req.query.limit, 20) || 20, 50));
    const sort = asText(req.query.sort);
    const user = await User.findById(req.user._id);

    // Determine sort option based on user selection
    let sortOption = { 'boost.priorityScore': -1, createdAt: -1 }; // Feature 3: boosted first
    if (sort === 'price_low') sortOption = { price: 1 };
    else if (sort === 'price_high') sortOption = { price: -1 };
    else if (sort === 'popular') sortOption = { likesCount: -1 };
    else if (sort === 'newest') sortOption = { createdAt: -1 };

    const listings = await Listing.find({
      seller: { $in: user.following },
      available: true,
      sold: false,
    })
      .populate('seller', 'name avatar')
      .sort(sortOption)
      .limit(limit)
      .skip((page - 1) * limit);

    const total = await Listing.countDocuments({
      seller: { $in: user.following },
      available: true,
      sold: false,
    });

    res.json({
      listings: listings.map((l) => {
        const doc = l.toObject ? l.toObject() : l;
        doc.boosted = doc.boost && doc.boost.active === true;
        return doc;
      }),
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id - Get user profile
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password')
      .populate('followers', 'name avatar')
      .populate('following', 'name avatar');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const listingsCount = await Listing.countDocuments({
      seller: user._id,
      sold: false,
    });

    res.json({ user, listingsCount });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/users/:id/follow - Toggle follow
router.post('/:id/follow', auth, async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot follow yourself' });
    }

    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const currentUser = await User.findById(req.user._id);
    const isFollowing = currentUser.following.includes(req.params.id);

    if (isFollowing) {
      currentUser.following.pull(req.params.id);
      targetUser.followers.pull(req.user._id);
    } else {
      currentUser.following.push(req.params.id);
      targetUser.followers.push(req.user._id);

      // Add notification
      targetUser.notifications.unshift({
        type: 'follow',
        from: req.user._id,
        message: `${req.user.name} started following you`,
      });
    }

    await currentUser.save();
    await targetUser.save();

    res.json({
      following: !isFollowing,
      followersCount: targetUser.followers.length,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/followers
router.get('/:id/followers', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('followers', 'name avatar bio');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user.followers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/following
router.get('/:id/following', async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('following', 'name avatar bio');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(user.following);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/closet - Get user's closet listings
router.get('/:id/closet', async (req, res) => {
  try {
    const { sort, page = 1, limit = 20 } = req.query;
    let sortOption = { createdAt: -1 };
    if (sort === 'price_low') sortOption = { price: 1 };
    else if (sort === 'price_high') sortOption = { price: -1 };
    else if (sort === 'popular') sortOption = { likesCount: -1 };
    else if (sort === 'newest') sortOption = { createdAt: -1 };

    // Clamp pagination like the marketplace feed: page >= 1 (no negative
    // skip → no 500s) and limit bounded (no unbounded collection dumps).
    const pageNum = Math.max(1, Math.min(Number(page) || 1, 100));
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 50));

    const listings = await Listing.find({
      seller: req.params.id,
      sold: false,
      available: true,
    })
      .populate('seller', 'name avatar')
      .sort(sortOption)
      .limit(limitNum)
      .skip((pageNum - 1) * limitNum);

    const total = await Listing.countDocuments({
      seller: req.params.id,
      sold: false,
      available: true,
    });

    res.json({
      listings,
      totalPages: Math.ceil(total / limitNum),
      currentPage: pageNum,
      total,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/users/:id/notifications
router.get('/:id/notifications', auth, async (req, res) => {
  try {
    if (req.params.id !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const user = await User.findById(req.params.id)
      .populate('notifications.from', 'name avatar')
      .populate('notifications.listing', 'title images price');

    res.json(user.notifications);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/users/:id/notifications/read
router.put('/:id/notifications/read', auth, async (req, res) => {
  try {
    if (req.params.id !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const user = await User.findById(req.params.id);
    user.notifications.forEach((n) => { n.read = true; });
    await user.save();

    res.json({ message: 'Notifications marked as read' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
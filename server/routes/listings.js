const express = require('express');
const router = express.Router();
const Listing = require('../models/Listing');
const User = require('../models/User');
const { auth, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { paginate } = require('../utils/pagination');

// Performance: Select only needed fields for list queries
const LISTING_LIST_FIELDS = 'title price originalPrice images seller category brand size condition likes sold createdAt';
const USER_PUBLIC_FIELDS = 'name avatar';

// GET /api/listings - Get all listings with filters
router.get('/', optionalAuth, async (req, res) => {
  try {
    const {
      category, brand, size, condition,
      minPrice, maxPrice, search, sort,
      page = 1, limit = 20
    } = req.query;

    // Clamp pagination for performance
    const pageNum = Math.max(1, Math.min(Number(page) || 1, 100));
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 50));

    let query = { available: true, sold: false, quantity: { $gt: 0 } };

    if (category) query.category = category;
    if (brand) query.brand = { $regex: brand, $options: 'i' };
    if (size) query.size = size;
    if (condition) query.condition = condition;
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = Number(minPrice);
      if (maxPrice) query.price.$lte = Number(maxPrice);
    }
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    let sortOption = { createdAt: -1 };
    if (sort === 'price_low') sortOption = { price: 1 };
    else if (sort === 'price_high') sortOption = { price: -1 };
    else if (sort === 'popular') sortOption = { 'likes.length': -1 };

    // Performance: lean() returns plain JS objects (faster, less memory)
    const result = await paginate(Listing, {
      page: pageNum,
      limit: limitNum,
      maxLimit: 50,
      sort: sortOption,
      filter: query,
      select: LISTING_LIST_FIELDS,
      populate: { path: 'seller', select: USER_PUBLIC_FIELDS },
      lean: true,
    });

    res.json({
      listings: result.docs,
      ...result.pagination,
    });
  }  catch (error) {
    // Return a clear 400 response when Mongoose validation fails (e.g., missing title).
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/listings/search - Search listings with legacy `q` parameter
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { q, limit = 20, page = 1 } = req.query;
    const search = q; // map legacy `q` to internal `search`
    const pageNum = Math.max(1, Math.min(Number(page) || 1, 100));
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 50));

    let query = { available: true, sold: false, quantity: { $gt: 0 } };
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { brand: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ];
    }

    const result = await paginate(Listing, {
      page: pageNum,
      limit: limitNum,
      maxLimit: 50,
      sort: { createdAt: -1 },
      filter: query,
      select: LISTING_LIST_FIELDS,
      populate: { path: 'seller', select: USER_PUBLIC_FIELDS },
      lean: true,
    });
    res.json({ listings: result.docs, ...result.pagination });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/listings/user/:userId - Get listings by user
router.get('/user/:userId', async (req, res) => {
  try {
    const { sort, page = 1, limit = 20 } = req.query;
    let sortOption = { createdAt: -1 };
    if (sort === 'price_low') sortOption = { price: 1 };
    else if (sort === 'price_high') sortOption = { price: -1 };

    const listings = await Listing.find({
      seller: req.params.userId,
      sold: false,
    })
      .populate('seller', 'name avatar')
      .sort(sortOption)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Listing.countDocuments({
      seller: req.params.userId,
      sold: false,
    });

    res.json({
      listings,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    // Handle Mongoose validation errors (e.g., missing required fields like title)
    // so the client receives a 400 Bad Request instead of a generic 500.
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/listings/:id - Get single listing
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('seller', 'name avatar bio location closetName followers following')
      .populate('comments.user', 'name avatar');

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Get similar listings
    const similar = await Listing.find({
      _id: { $ne: listing._id },
      category: listing.category,
      available: true,
      sold: false,
    })
      .populate('seller', 'name avatar')
      .limit(6);

    res.json({ listing, similar });
  } catch (error) {
    // Return a clear 400 response for validation failures (e.g., missing required fields).
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/listings - Create listing
router.post('/', auth, upload.array('images', 10), async (req, res) => {
  try {
    const {
      title, description, price, originalPrice,
      category, brand, size, condition, color,
      weight, weightUnit, shipsFrom,
      domesticShipping, internationalShipping, freeShipping, shippingCost,
      quantity,
    } = req.body;

    let imageUrls = [];

    if (req.files && req.files.length > 0) {
      const { cloudinary } = require('../config/cloudinary');
      for (const file of req.files) {
        const b64 = Buffer.from(file.buffer).toString('base64');
        const dataURI = `data:${file.mimetype};base64,${b64}`;
        const result = await cloudinary.uploader.upload(dataURI, {
          folder: 'trend-drop/listings',
          transformation: [{ width: 800, height: 800, crop: 'limit' }],
        });
        imageUrls.push(result.secure_url);
      }
    }

    // Minimum price: $5 to prevent low-value orders losing money after Stripe fees
    if (Number(price) < 5) {
      return res.status(400).json({ message: 'Minimum listing price is $5.00' });
    }

    const listing = await Listing.create({
      seller: req.user._id,
      title,
      description,
      price: Number(price),
      originalPrice: originalPrice ? Number(originalPrice) : undefined,
      images: imageUrls,
      category,
      brand,
      size,
      condition,
      color,
      weight: weight ? Number(weight) : 0.5,
      weightUnit: weightUnit || 'kg',
      shipsFrom: shipsFrom || 'US',
      shipping: {
        domestic: domesticShipping !== 'false' && domesticShipping !== false,
        international: internationalShipping === 'true' || internationalShipping === true,
        freeShipping: freeShipping === 'true' || freeShipping === true,
        shippingCost: shippingCost ? Number(shippingCost) : 0,
      },
      quantity: quantity ? Number(quantity) : 1,
    });

    await listing.populate('seller', 'name avatar');
    res.status(201).json(listing);
  } catch (error) {
    // Return a clear 400 response when Mongoose validation fails (e.g., missing title).
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/listings/:id - Update listing
router.put('/:id', auth, upload.array('images', 10), async (req, res) => {
  try {
    let listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const updateData = { ...req.body };
    if (req.files && req.files.length > 0) {
      const { cloudinary } = require('../config/cloudinary');
      const imageUrls = [];
      for (const file of req.files) {
        const b64 = Buffer.from(file.buffer).toString('base64');
        const dataURI = `data:${file.mimetype};base64,${b64}`;
        const result = await cloudinary.uploader.upload(dataURI, {
          folder: 'trend-drop/listings',
          transformation: [{ width: 800, height: 800, crop: 'limit' }],
        });
        imageUrls.push(result.secure_url);
      }
      updateData.images = imageUrls;
    }

    if (updateData.price) {
      updateData.price = Number(updateData.price);
      // Minimum price: $5
      if (updateData.price < 5) {
        return res.status(400).json({ message: 'Minimum listing price is $5.00' });
      }
    }
    if (updateData.originalPrice) updateData.originalPrice = Number(updateData.originalPrice);

    listing = await Listing.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true }
    ).populate('seller', 'name avatar');

    res.json(listing);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/listings/:id - Delete listing + cleanup Cloudinary images
router.delete('/:id', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    // Auto-delete images from Cloudinary
    if (listing.images && listing.images.length > 0) {
      try {
        const { cloudinary } = require('../config/cloudinary');
        for (const imageUrl of listing.images) {
          // Extract public_id from Cloudinary URL
          const parts = imageUrl.split('/');
          const folderIdx = parts.findIndex(p => p === 'trend-drop');
          if (folderIdx > -1) {
            const publicId = parts.slice(folderIdx).join('/').replace(/\.[^.]+$/, '');
            await cloudinary.uploader.destroy(publicId);
          }
        }
      } catch (imgErr) {
        console.error('Image cleanup error:', imgErr);
        // Don't fail the deletion if image cleanup fails
      }
    }

    await listing.deleteOne();
    res.json({ message: 'Listing and images removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

 // POST /api/listings/:id/boost - Boost a listing
 // Fee is applied when the boosted item is sold (deducted from seller's pending earnings)
router.post('/:id/boost', auth, async (req, res) => {
  try {
    const { tier, durationDays } = req.body;
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }
    if (listing.boost?.active) {
      return res.status(400).json({ message: 'Listing is already boosted' });
    }

    const { calculateBoostFee } = require('../config/boost');
    const boostInfo = calculateBoostFee(listing.price, tier || 'standard', durationDays || 14);

    // Activate boost (fee will be deducted when the item is sold)
    listing.boost = {
      active: true,
      tier: tier || 'standard',
      startDate: new Date(),
      endDate: new Date(Date.now() + (durationDays || 14) * 24 * 60 * 60 * 1000),
      durationDays: durationDays || 14,
      fee: boostInfo.fee,
      priorityScore: boostInfo.priorityScore,
    };
    await listing.save();

    res.json({
      message: `Listing boosted with ${boostInfo.tier}!`,
      boost: listing.boost,
      fee: boostInfo.fee,
      features: boostInfo.features,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/listings/:id/deactivate-boost - Deactivate boost
router.post('/:id/deactivate-boost', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    listing.boost = { active: false, tier: '', durationDays: 14, fee: 0, priorityScore: 0 };
    await listing.save();

    res.json({ message: 'Boost deactivated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/listings/:id/like - Toggle like
router.post('/:id/like', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const index = listing.likes.indexOf(req.user._id);
    if (index > -1) {
      listing.likes.splice(index, 1);
    } else {
      listing.likes.push(req.user._id);

      // Add notification to seller
      if (listing.seller.toString() !== req.user._id.toString()) {
        const seller = await User.findById(listing.seller);
        if (seller) {
          seller.notifications.unshift({
            type: 'like',
            from: req.user._id,
            listing: listing._id,
            message: `${req.user.name} liked your listing "${listing.title}"`,
          });
          await seller.save();
        }
      }
    }

    await listing.save();
    res.json({ likes: listing.likes, liked: index === -1 });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/listings/:id/comment - Add comment
router.post('/:id/comment', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ message: 'Comment text is required' });
    }

    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    listing.comments.unshift({
      user: req.user._id,
      text,
    });
    await listing.save();

    // Add notification
    if (listing.seller.toString() !== req.user._id.toString()) {
      const seller = await User.findById(listing.seller);
      if (seller) {
        seller.notifications.unshift({
          type: 'comment',
          from: req.user._id,
          listing: listing._id,
          message: `${req.user.name} commented on "${listing.title}"`,
        });
        await seller.save();
      }
    }

    const populated = await Listing.findById(req.params.id)
      .populate('comments.user', 'name avatar');

    res.json(populated.comments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// DELETE /api/listings/:id/comments/:commentId
router.delete('/:id/comments/:commentId', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const comment = listing.comments.id(req.params.commentId);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }

    if (comment.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    comment.deleteOne();
    await listing.save();

    res.json(listing.comments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/listings/:id/share - Share listing
router.post('/:id/share', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (!listing.shares.includes(req.user._id)) {
      listing.shares.push(req.user._id);
      await listing.save();
    }

    res.json({ shares: listing.shares.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/listings/:id/sold - Mark as sold
// PATCH /api/listings/:id/sold - Manual mark as sold is now disabled.
router.patch('/:id/sold', auth, async (req, res) => {
  // This endpoint is retained for backward compatibility but will always reject the request.
  return res.status(400).json({ message: 'Manual marking as sold is disabled. Sales are recorded via transaction flow.' });
});

module.exports = router;
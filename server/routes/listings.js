const express = require('express');
const router = express.Router();
const Listing = require('../models/Listing');
const User = require('../models/User');
const { auth, optionalAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { paginate } = require('../utils/pagination');
const { isInternationalShippingEnabled } = require('../config/features');
const { hasActiveShopBoost, applyShopBoostToSeller } = require('../services/shopBoostService');
const { parseAutoRespondBody, buildAutoRespondForCreate } = require('../services/autoRespondService');

const LISTING_LIST_FIELDS = 'title price originalPrice images videoUrl seller category brand size condition likes sold createdAt status boost';
const USER_PUBLIC_FIELDS = 'name avatar';

// Feature 3 — expose a computed `boosted` boolean on catalog docs so cards
// can render the boost badge (works for individual + shop-boosted items).
const markBoosted = (doc) => {
  if (doc && typeof doc === 'object') {
    doc.boosted = doc.boost && doc.boost.active === true;
  }
  return doc;
};

// Listing image uploads.
// In test mode (or when Cloudinary credentials are absent) files are NOT
// uploaded to Cloudinary — a deterministic local placeholder URL is stored
// instead so listing creation works offline and in CI without network or
// secrets. Production still uploads to Cloudinary.
const uploadListingImages = async (files) => {
  const imageUrls = [];
  if (!files || files.length === 0) return imageUrls;
  const cloudConfigured = process.env.CLOUDINARY_CLOUD_NAME
    && process.env.CLOUDINARY_API_KEY
    && process.env.CLOUDINARY_API_SECRET;
  const useMock = process.env.NODE_ENV === 'test' || !cloudConfigured;
  if (useMock) {
    for (const file of files) {
      imageUrls.push(`test://listing-image/${Date.now()}-${file.originalname || 'image.png'}`);
    }
    return imageUrls;
  }
  const { cloudinary } = require('../config/cloudinary');
  for (const file of files) {
    const b64 = Buffer.from(file.buffer).toString('base64');
    const dataURI = `data:${file.mimetype};base64,${b64}`;
    const result = await cloudinary.uploader.upload(dataURI, {
      folder: 'trend-drop/listings',
      transformation: [{ width: 800, height: 800, crop: 'limit' }],
    });
    imageUrls.push(result.secure_url);
  }
  return imageUrls;
};

router.get('/', optionalAuth, async (req, res) => {
  try {
    const { category, brand, size, condition, minPrice, maxPrice, search, sort, page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, Math.min(Number(page) || 1, 100));
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 50));

    let query = { available: true, sold: false, quantity: { $gt: 0 }, status: 'active' };

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

    let sortOption = { 'boost.priorityScore': -1, createdAt: -1 }; // Feature 3: boosted first
    if (sort === 'price_low') sortOption = { price: 1 };
    else if (sort === 'price_high') sortOption = { price: -1 };
    else if (sort === 'popular') sortOption = { likesCount: -1 };
    else if (sort === 'newest') sortOption = { createdAt: -1 };

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

    if (Array.isArray(result.docs)) result.docs.forEach(markBoosted);

    res.json({ listings: result.docs, ...result.pagination });
  } catch (error) {
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/search', optionalAuth, async (req, res) => {
  try {
    const { q, limit = 20, page = 1 } = req.query;
    const search = q;
    const pageNum = Math.max(1, Math.min(Number(page) || 1, 100));
    const limitNum = Math.max(1, Math.min(Number(limit) || 20, 50));

    let query = { available: true, sold: false, quantity: { $gt: 0 }, status: 'active' };
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
      sort: { 'boost.priorityScore': -1, createdAt: -1 },
      filter: query,
      select: LISTING_LIST_FIELDS,
      populate: { path: 'seller', select: USER_PUBLIC_FIELDS },
      lean: true,
    });

    if (Array.isArray(result.docs)) result.docs.forEach(markBoosted);
    res.json({ listings: result.docs, ...result.pagination });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/user/:userId', async (req, res) => {
  try {
    const { sort, page = 1, limit = 20 } = req.query;
    let sortOption = { createdAt: -1 };
    if (sort === 'price_low') sortOption = { price: 1 };
    else if (sort === 'price_high') sortOption = { price: -1 };

    const listings = await Listing.find({ seller: req.params.userId, sold: false })
      .populate('seller', 'name avatar')
      .sort(sortOption)
      .limit(Number(limit))
      .skip((Number(page) - 1) * Number(limit));

    const total = await Listing.countDocuments({ seller: req.params.userId, sold: false });

    res.json({
      listings,
      totalPages: Math.ceil(total / Number(limit)),
      currentPage: Number(page),
      total,
    });
  } catch (error) {
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/listings/bulk/auto-respond (Feature 4)
// Bulk auto-respond toggle for ALL of the seller's unsold listings.
// Bulk-enable stamps each listing with minPrice = its own price
// ("auto-accept offers at or above list price"). Bulk-disable turns
// autoRespond off while preserving minPrice/autoOfferToLikers settings.
// Registered before /:id routes so "bulk" is never parsed as an id.
router.patch('/bulk/auto-respond', auth, async (req, res) => {
  try {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ message: 'enabled (boolean) is required' });
    }
    const listings = await Listing.find({ seller: req.user._id, sold: false });
    let updated = 0;
    for (const listing of listings) {
      const current = (listing.autoRespond && typeof listing.autoRespond.toObject === 'function')
        ? listing.autoRespond.toObject()
        : (listing.autoRespond || {});
      if (enabled) {
        listing.autoRespond = { ...current, enabled: true, minPrice: Number(listing.price), currency: listing.currency || 'USD' };
      } else {
        listing.autoRespond = { ...current, enabled: false };
      }
      await listing.save();
      updated += 1;
    }
    res.json({
      message: `Auto-respond ${enabled ? 'enabled' : 'disabled'} for ${updated} listing${updated === 1 ? '' : 's'}`,
      updated,
      listings: listings.map((l) => ({ _id: l._id, autoRespond: l.autoRespond })),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/listings/my - Get current user's unsold listings (for auction creation)
router.get('/my', auth, async (req, res) => {
  try {
    // Parse query params as strings (Express query parser returns strings)
    const soldStr = req.query.sold;
    const availableStr = req.query.available;
    const status = req.query.status;
    
    let query = { seller: req.user._id };
    
    // Default to unsold, available, active listings
    if (soldStr !== undefined) query.sold = soldStr === 'true';
    else query.sold = false;
    
    if (availableStr !== undefined) query.available = availableStr === 'true';
    else query.available = true;
    
    if (status !== undefined) query.status = status;
    else query.status = 'active';

    const listings = await Listing.find(query)
      .populate('seller', 'name avatar')
      .sort({ createdAt: -1 });

    res.json({ listings });
  } catch (error) {
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('seller', 'name avatar bio location closetName followers following')
      .populate('comments.user', 'name avatar');

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.status === 'draft' && (!req.user || listing.seller._id.toString() !== req.user._id.toString())) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const similar = await Listing.find({
      _id: { $ne: listing._id },
      category: listing.category,
      available: true,
      sold: false,
      status: 'active',
    })
      .populate('seller', 'name avatar')
      .limit(6);

    res.json({ listing, similar });
  } catch (error) {
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/', auth, upload.array('images', 10), async (req, res) => {
  try {
    const {
      title, description, price, originalPrice,
      category, brand, size, condition, color,
      weight, weightUnit, shipsFrom, currency,
      domesticShipping, internationalShipping, freeShipping, shippingCost,
      quantity, videoUrl, status,
      boostTier, boostDuration,
    } = req.body;

    const imageUrls = await uploadListingImages(req.files);

    if (Number(price) < 5) {
      return res.status(400).json({ message: 'Minimum listing price is $5.00' });
    }

    // Feature 2 — international shipping flag: when disabled, listings may
    // NOT declare cross-country shipping.
    const wantsInternational = internationalShipping === 'true' || internationalShipping === true;
    if (wantsInternational && !isInternationalShippingEnabled()) {
      return res.status(400).json({
        message: "International shipping is currently disabled. This listing can only ship within the seller's country.",
      });
    }

    let boostData = { active: false, tier: '', durationDays: 14, fee: 0, priorityScore: 0 };

    if (boostTier && ['standard', 'premium', 'elite'].includes(boostTier)) {
      const { calculateBoostFee } = require('../config/boost');
      const duration = boostDuration ? Number(boostDuration) : 14;
      const boostInfo = calculateBoostFee(Number(price), boostTier, duration);
      boostData = {
        active: true,
        tier: boostTier,
        startDate: new Date(),
        endDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
        durationDays: duration,
        fee: boostInfo.fee,
        priorityScore: boostInfo.priorityScore,
      };
    }

    const isDraft = status === 'draft';

    // Feature 4 — auto-respond / enterprise auto-offer at creation.
    const arParsed = parseAutoRespondBody(req.body);
    const arBuild = buildAutoRespondForCreate(arParsed, { price: Number(price), currency: currency || 'USD' });
    if (arBuild.error) {
      return res.status(400).json({ message: arBuild.error });
    }

    const listing = await Listing.create({
      seller: req.user._id,
      title,
      description,
      price: Number(price),
      originalPrice: originalPrice ? Number(originalPrice) : undefined,
      currency: currency || 'USD',
      images: imageUrls,
      videoUrl: videoUrl || '',
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
      status: isDraft ? 'draft' : 'active',
      available: !isDraft,
      quantity: quantity ? Number(quantity) : 1,
      boost: boostData,
      autoRespond: arBuild.autoRespond,
    });

    // Feature 3 — if the seller has an active shop boost, the new listing
    // joins the shop boost (basic tier, highest priority) automatically.
    if (await hasActiveShopBoost(req.user._id)) {
      await applyShopBoostToSeller(req.user._id);
    }

    const savedListing = await Listing.findById(listing._id).populate('seller', 'name avatar');
    res.status(201).json({ listing: savedListing });
  } catch (error) {
    console.error(error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: 'Server error' });
  }
});

// Helper to process the PUT request body handling both multipart and JSON
router.put('/:id', auth, (req, res, next) => {
  // Check if content type is multipart/form-data (has file uploads)
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    upload.array('images', 10)(req, res, (err) => {
      if (err) return res.status(400).json({ message: err.message });
      next();
    });
  } else {
    // JSON body - skip multer
    next();
  }
}, async (req, res) => {
  try {
    let listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    const {
      title, description, price, originalPrice,
      category, brand, size, condition, color,
      weight, weightUnit, shipsFrom,
      domesticShipping, internationalShipping, freeShipping, shippingCost,
      quantity, videoUrl, status, available,
      boostTier, boostDuration, removeBoost,
      existingImages,
    } = req.body;

    // String-aware boolean coercion: multipart/form-data fields arrive as
    // strings ("true"/"false"), so Boolean("false") would incorrectly be true.
    const toBool = (v) => {
      if (typeof v === 'boolean') return v;
      if (v === 'true') return true;
      if (v === 'false') return false;
      return undefined;
    };

    const updateData = {};

    let imageUrls = [];
    if (existingImages) {
      try {
        const imagesToKeep = typeof existingImages === 'string' ? JSON.parse(existingImages) : existingImages;
        if (Array.isArray(imagesToKeep)) {
          imageUrls = [...imagesToKeep];
        }
      } catch (e) {
        // ignore parse error
      }
    }

    if (req.files && req.files.length > 0) {
      const uploaded = await uploadListingImages(req.files);
      imageUrls.push(...uploaded);
    }

    if (imageUrls.length > 0 || existingImages !== undefined) {
      updateData.images = imageUrls;
    }

    if (title) updateData.title = title;
    if (description) updateData.description = description;
    if (category) updateData.category = category;
    if (brand !== undefined) updateData.brand = brand;
    if (size !== undefined) updateData.size = size;
    if (condition) updateData.condition = condition;
    if (color !== undefined) updateData.color = color;
    if (videoUrl !== undefined) updateData.videoUrl = videoUrl;
    if (quantity !== undefined && quantity !== '') updateData.quantity = Number(quantity);
    if (status) {
      updateData.status = status;
      if (status === 'active') updateData.available = true;
      if (status === 'draft') updateData.available = false;
    }
    if (available !== undefined) {
      const b = toBool(available);
      if (b !== undefined) updateData.available = b;
    }

    if (price) {
      updateData.price = Number(price);
      if (updateData.price < 5) {
        return res.status(400).json({ message: 'Minimum listing price is $5.00' });
      }
    }
    if (originalPrice) updateData.originalPrice = Number(originalPrice);

    if (weight) updateData.weight = Number(weight);
    if (weightUnit) updateData.weightUnit = weightUnit;
    if (shipsFrom) updateData.shipsFrom = shipsFrom;

    const shippingUpdate = {};
    if (domesticShipping !== undefined) shippingUpdate.domestic = domesticShipping === 'true' || domesticShipping === true;
    if (internationalShipping !== undefined) {
      shippingUpdate.international = internationalShipping === 'true' || internationalShipping === true;
      // Feature 2 — international shipping flag: when disabled, listings may
      // NOT switch on cross-country shipping.
      if (shippingUpdate.international && !isInternationalShippingEnabled()) {
        return res.status(400).json({
          message: "International shipping is currently disabled. This listing can only ship within the seller's country.",
        });
      }
    }
    if (freeShipping !== undefined) shippingUpdate.freeShipping = freeShipping === 'true' || freeShipping === true;
    if (shippingCost !== undefined) shippingUpdate.shippingCost = Number(shippingCost);
    
    if (Object.keys(shippingUpdate).length > 0) {
      updateData.shipping = { ...(listing.shipping ? listing.shipping.toObject() : {}), ...shippingUpdate };
    }

    // Boost handling
    if (removeBoost === 'true' || removeBoost === true) {
      updateData.boost = { active: false, tier: '', durationDays: 14, fee: 0, priorityScore: 0, individuallyBoosted: false };
    } else if (boostTier && ['standard', 'premium', 'elite'].includes(boostTier)) {
      const { calculateBoostFee } = require('../config/boost');
      const listingPrice = updateData.price || listing.price;
      const duration = boostDuration ? Number(boostDuration) : 14;
      const boostInfo = calculateBoostFee(listingPrice, boostTier, duration);
      updateData.boost = {
        active: true,
        tier: boostTier,
        startDate: new Date(),
        endDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000),
        durationDays: duration,
        fee: boostInfo.fee,
        priorityScore: boostInfo.priorityScore,
        individuallyBoosted: true, // Feature 3
      };
    } else if (updateData.price && listing.boost && listing.boost.active) {
      const { calculateBoostFee } = require('../config/boost');
      const boostInfo = calculateBoostFee(updateData.price, listing.boost.tier, listing.boost.durationDays || 14);
      const boostObj = listing.boost.toObject ? listing.boost.toObject() : listing.boost;
      updateData.boost = { ...boostObj, fee: boostInfo.fee };
    }

    // Feature 4 — auto-respond / enterprise auto-offer during edit.
    const { buildAutoRespondForUpdate } = require('../services/autoRespondService');
    const arParsedEdit = parseAutoRespondBody(req.body);
    if (arParsedEdit.provided) {
      const arBuildEdit = buildAutoRespondForUpdate(arParsedEdit, listing.autoRespond, {
        effectivePrice: updateData.price || listing.price,
        listingCurrency: listing.currency || 'USD',
      });
      if (arBuildEdit.error) {
        return res.status(400).json({ message: arBuildEdit.error });
      }
      if (arBuildEdit.autoRespond) {
        updateData.autoRespond = arBuildEdit.autoRespond;
      }
    }

    const oldPrice = listing.price;

    listing = await Listing.findByIdAndUpdate(req.params.id, { $set: updateData }, { new: true }).populate('seller', 'name avatar');

    // Price drop notification & price history tracking
    if (updateData.price && listing.price < oldPrice) {
      const PriceHistory = require('../models/PriceHistory');
      const newPrice = listing.price;
      const priceDrop = oldPrice - newPrice;
      const dropPercent = Math.round((priceDrop / oldPrice) * 100);

      // Record price history
      try {
        await PriceHistory.create({
          listing: listing._id,
          price: newPrice,
          oldPrice,
          newPrice,
          changedBy: req.user._id,
          reason: 'price_drop',
        });
      } catch (histErr) {
        console.error('PriceHistory record error:', histErr);
      }

      // Notify all likers (excluding seller)
      const likers = listing.likes.filter(l => l.toString() !== req.user._id.toString());
      if (likers.length > 0) {
        const message = `Price drop! "${listing.title}" is now $${newPrice} (was $${oldPrice}, ${dropPercent}% off)`;
        const bulkOps = likers.map(likerId => ({
          updateOne: {
            filter: { _id: likerId },
            update: {
              $push: {
                notifications: {
                  $each: [{
                    type: 'priceDrop',
                    from: req.user._id,
                    listing: listing._id,
                    message,
                    read: false,
                    createdAt: new Date(),
                  }],
                  $position: 0,
                },
              },
            },
          },
        }));
        try {
          await User.bulkWrite(bulkOps);

          // Update notified count on latest price history entry
          await PriceHistory.updateOne(
            { listing: listing._id, reason: 'price_drop', oldPrice },
            { $set: { notifiedLikers: likers.length } }
          );
        } catch (notifErr) {
          console.error('Price drop notification error:', notifErr);
        }
      }
    }

    // Feature 3 — if the seller has an active shop boost, keep the listing
    // joined (e.g. after disabling/enabling individual boost or repricing).
    if (await hasActiveShopBoost(listing.seller)) {
      await applyShopBoostToSeller(listing.seller);
      listing = await Listing.findById(listing._id).populate('seller', 'name avatar');
    }

    res.json({ listing });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    if (listing.images && listing.images.length > 0) {
      try {
        const { cloudinary } = require('../config/cloudinary');
        for (const imageUrl of listing.images) {
          const parts = imageUrl.split('/');
          const folderIdx = parts.findIndex(p => p === 'trend-drop');
          if (folderIdx > -1) {
            const publicId = parts.slice(folderIdx).join('/').replace(/\.[^.]+$/, '');
            await cloudinary.uploader.destroy(publicId);
          }
        }
      } catch (imgErr) {
        console.error('Image cleanup error:', imgErr);
      }
    }

    await listing.deleteOne();
    res.json({ message: 'Listing and images removed' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

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
    // Feature 3: a shop-boosted listing (source 'shop') may still be upgraded
    // with an individual boost; an already-individually-boosted listing can't.
    if (listing.boost?.active && (listing.boost.source || 'listing') !== 'shop') {
      return res.status(400).json({ message: 'Listing is already boosted' });
    }

    const { calculateBoostFee } = require('../config/boost');
    const boostInfo = calculateBoostFee(listing.price, tier || 'standard', durationDays || 14);

    listing.boost = {
      active: true,
      tier: tier || 'standard',
      startDate: new Date(),
      endDate: new Date(Date.now() + (durationDays || 14) * 24 * 60 * 60 * 1000),
      durationDays: durationDays || 14,
      fee: boostInfo.fee,
      priorityScore: boostInfo.priorityScore,
      source: listing.boost?.source || 'listing',
      individuallyBoosted: true, // Feature 3: truthful individual-boost flag
    };
    await listing.save();

    // Feature 3: keep the listing joined to an active shop boost (bumps
    // priority to the shop-max level and marks the source 'both').
    if (await hasActiveShopBoost(listing.seller)) {
      await applyShopBoostToSeller(listing.seller);
    }

    const boosted = await Listing.findById(listing._id);

    res.json({
      message: `Listing boosted with ${boostInfo.tier}!`,
      boost: boosted.boost,
      fee: boostInfo.fee,
      features: boostInfo.features,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/deactivate-boost', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    if (listing.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized' });
    }

    listing.boost = { active: false, tier: '', durationDays: 14, fee: 0, priorityScore: 0, source: listing.boost?.source || 'listing', individuallyBoosted: false };
    await listing.save();

    // Feature 3: if the seller's shop boost is active, the listing stays
    // boosted (all items are shop-boosted) — only the individual part is removed.
    if (await hasActiveShopBoost(listing.seller)) {
      await applyShopBoostToSeller(listing.seller);
    }

    res.json({ message: 'Boost deactivated' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

router.post('/:id/like', auth, async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const Wishlist = require('../models/Wishlist');
    const index = listing.likes.indexOf(req.user._id);
    let liked = false;
    
    if (index > -1) {
      listing.likes.splice(index, 1);
      listing.likesCount = Math.max(0, (listing.likesCount || 0) - 1);
      liked = false;
      
      let wishlist = await Wishlist.findOne({ user: req.user._id });
      if (wishlist) {
        wishlist.items = wishlist.items.filter(i => i.listing.toString() !== req.params.id);
        await wishlist.save();
      }
    } else {
      listing.likes.push(req.user._id);
      listing.likesCount = (listing.likesCount || 0) + 1;
      liked = true;

      let wishlist = await Wishlist.findOne({ user: req.user._id });
      if (!wishlist) {
        wishlist = await Wishlist.create({ user: req.user._id, items: [{ listing: req.params.id }] });
      } else {
        const exists = wishlist.items.find(i => i.listing.toString() === req.params.id);
        if (!exists) {
          wishlist.items.push({ listing: req.params.id });
          await wishlist.save();
        }
      }

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

      // Feature 4 — likers automatically receive an accepted offer at the
      // least price when the seller enabled auto-offer to likers.
      if (liked && listing.autoRespond && listing.autoRespond.enabled === true
        && listing.autoRespond.autoOfferToLikers === true
        && Number(listing.autoRespond.minPrice) > 0
        && listing.seller.toString() !== req.user._id.toString()) {
        const Offer = require('../models/Offer');
        const existingLikerOffer = await Offer.findOne({
          listing: listing._id,
          buyer: req.user._id,
          status: { $in: ['pending', 'countered', 'buyer_countered', 'accepted'] },
        });
        if (!existingLikerOffer) {
          const least = Number(listing.autoRespond.minPrice);
          const likerOffer = await Offer.create({
            listing: listing._id,
            buyer: req.user._id,
            seller: listing.seller,
            amount: least,
            currency: listing.currency || 'USD',
            status: 'accepted',
            acceptedPrice: least,
            acceptedAt: new Date(),
            acceptedBy: 'seller',
            acceptedUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
            buyerMessage: 'Auto-offer to liker',
            counterHistory: [{ amount: least, counteredBy: 'seller', message: 'Auto-offer to liker' }],
            lastCounterBy: 'seller',
            autoResponded: true,
          });
          const likerUser = await User.findById(req.user._id);
          if (likerUser) {
            likerUser.notifications.unshift({
              type: 'offer',
              from: listing.seller,
              listing: listing._id,
              message: `Good news! The seller sent you an offer of ${likerOffer.currency} ${least} on "${listing.title}". Proceed to purchase.`,
            });
            await likerUser.save();
          }
        }
      }
    }

    await listing.save();
    res.json({ likes: listing.likes, liked });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

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

    listing.comments.unshift({ user: req.user._id, text });
    await listing.save();

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

router.patch('/:id/sold', auth, async (req, res) => {
  return res.status(400).json({ message: 'Manual marking as sold is disabled. Sales are recorded via transaction flow.' });
});

// POST /api/listings/:id/relist - Seller relists a previously sold item (Poshmark "Reposh" style)
router.post('/:id/relist', auth, async (req, res) => {
  try {
    const source = await Listing.findById(req.params.id);
    if (!source) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    // Only the seller can relist
    if (source.seller.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to relist this item' });
    }

    // Only sold listings can be relisted.
    // NOTE: The purchase flow (confirm-batch) marks listings `sold: true`
    // but leaves `status: 'active'` for public-hiding semantics.
    // Guarding on `sold` alone is the canonical check, so reposh works
    // for every purchase path (single + batch) across platforms.
    if (!source.sold) {
      return res.status(400).json({ message: 'Only sold items can be relisted' });
    }

    const { price, description, title, brand, size, condition, category, images, originalPrice } = req.body;

    const relisted = await Listing.create({
      seller: source.seller,
      title: title || source.title,
      description: description || source.description,
      price: price !== undefined ? price : source.price,
      originalPrice: originalPrice !== undefined ? originalPrice : source.originalPrice,
      currency: source.currency,
      images: images && images.length ? images : source.images,
      videoUrl: source.videoUrl,
      category: category || source.category,
      brand: brand || source.brand,
      size: size || source.size,
      condition: condition || source.condition,
      color: source.color,
      weight: source.weight,
      weightUnit: source.weightUnit,
      dimensions: source.dimensions,
      shipping: source.shipping,
      shipsFrom: source.shipsFrom,
      available: true,
      sold: false,
      status: 'active',
      quantity: source.quantity > 0 ? source.quantity : 1,
      quantitySold: 0,
      reserved: 0,
    });

    // Return wrapped in { listing: ... } for client compatibility and use 200 status
    res.status(200).json({ listing: relisted });
  } catch (error) {
    console.error('Relist error:', error);
    res.status(500).json({ message: 'Failed to relist item' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const ShopBoost = require('../models/ShopBoost');
const Listing = require('../models/Listing');
const { auth } = require('../middleware/auth');
const {
  SHOP_BOOST_DURATION_DAYS,
  SHOP_BOOST_PRIORITY_SCORE,
  applyShopBoostToSeller,
  removeShopBoostFromSeller,
  boostShopConfig,
} = require('../services/shopBoostService');

const DEFAULT_DURATION_MS = SHOP_BOOST_DURATION_DAYS * 24 * 60 * 60 * 1000;

// POST /api/shop-boost - Activate "boost whole shop" for the current seller.
router.post('/', auth, async (req, res) => {
  try {
    const { durationDays } = req.body;
    const days = Math.max(7, Math.min(Number(durationDays) || SHOP_BOOST_DURATION_DAYS, 90));

    let shopBoost = await ShopBoost.findOne({ seller: req.user._id });
    if (!shopBoost) {
      shopBoost = await ShopBoost.create({
        seller: req.user._id,
        active: true,
        tier: boostShopConfig.tier,
        startDate: new Date(),
        endDate: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        durationDays: days,
        feePercent: boostShopConfig.feePercent,
      });
    } else {
      shopBoost.active = true;
      shopBoost.tier = boostShopConfig.tier;
      shopBoost.startDate = new Date();
      shopBoost.endDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
      shopBoost.durationDays = days;
      shopBoost.feePercent = boostShopConfig.feePercent;
      await shopBoost.save();
    }

    // Materialize onto every active listing right away.
    await applyShopBoostToSeller(req.user._id, SHOP_BOOST_PRIORITY_SCORE);

    const boosted = await Listing.countDocuments({
      seller: req.user._id,
      available: true,
      sold: false,
      'boost.active': true,
    });

    res.json({ message: 'Shop boost enabled — every listing is boosted.', shopBoost, boostedListings: boosted });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/shop-boost/deactivate - Turn off the shop boost.
router.patch('/deactivate', auth, async (req, res) => {
  try {
    let shopBoost = await ShopBoost.findOne({ seller: req.user._id });
    if (!shopBoost) {
      shopBoost = await ShopBoost.create({ seller: req.user._id, active: false });
    }

    if (!shopBoost.active) {
      return res.json({ message: 'Shop boost is already disabled.', shopBoost });
    }

    shopBoost.active = false;
    await shopBoost.save();
    await removeShopBoostFromSeller(req.user._id);

    res.json({ message: 'Shop boost disabled. Listings restored to normal.', shopBoost });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/shop-boost - Current seller's shop boost status.
router.get('/', auth, async (req, res) => {
  try {
    let shopBoost = await ShopBoost.findOne({ seller: req.user._id });
    if (!shopBoost) {
      shopBoost = await ShopBoost.create({ seller: req.user._id, active: false });
    }
    res.json({ shopBoost });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/shop-boost/status/:sellerId - Public status for a seller's shop.
router.get('/status/:sellerId', async (req, res) => {
  try {
    const shopBoost = await ShopBoost.findOne({
      seller: req.params.sellerId,
      active: true,
      endDate: { $gt: new Date() },
    });
    res.json({ active: Boolean(shopBoost), tier: shopBoost ? shopBoost.tier : null, seller: req.params.sellerId });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
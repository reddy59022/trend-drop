const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Subscription = require('../models/Subscription');

// GET /api/subscriptions/plans - Get available subscription plans
const MONTHLY_PRICES = { basic: 9.99, pro: 29.99, enterprise: 99.99 };
const annualPriceFor = (tier) => Math.round(MONTHLY_PRICES[tier] * 12 * 0.8 * 100) / 100;
const priceFor = (tier, billingCycle) => billingCycle === 'annual' ? annualPriceFor(tier) : MONTHLY_PRICES[tier];

router.get('/plans', async (req, res) => {
  try {
    res.json([
      { id: 'free', name: 'Free', price: 0, annualPrice: 0, features: { analyticsAccess: false, reducedFees: false } },
      { id: 'basic', name: 'Basic', price: MONTHLY_PRICES.basic, annualPrice: annualPriceFor('basic'), features: { reducedFees: true, analyticsAccess: true, prioritySupport: false } },
      { id: 'pro', name: 'Pro', price: MONTHLY_PRICES.pro, annualPrice: annualPriceFor('pro'), features: { reducedFees: true, analyticsAccess: true, prioritySupport: true, enhancedPromotions: true } },
      { id: 'enterprise', name: 'Enterprise', price: MONTHLY_PRICES.enterprise, annualPrice: annualPriceFor('enterprise'), features: { reducedFees: true, analyticsAccess: true, prioritySupport: true, enhancedPromotions: true, customDomain: true } },
    ]);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch plans' });
  }
});

// GET /api/subscriptions - Get user's subscription
router.get('/', auth, async (req, res) => {
  try {
    let subscription = await Subscription.findOne({ seller: req.user._id, status: 'active' });
    
    if (!subscription) {
      subscription = await Subscription.create({
        seller: req.user._id,
        tier: 'free',
        features: { analyticsAccess: false, reducedFees: false },
      });
    }
    
    res.json(subscription);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch subscription' });
  }
});

// POST /api/subscriptions/subscribe - Subscribe to a plan
router.post('/subscribe', auth, async (req, res) => {
  try {
    const { tier, billingCycle = 'monthly' } = req.body;
    
    if (!['basic', 'pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ message: 'Invalid tier' });
    }
    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({ message: 'billingCycle must be monthly or annual' });
    }

    // Derive every entitlement and price from the selected tier on EVERY
    // change. Updating only tier/billingCycle left an existing subscription's
    // old price/features behind (for example, an Enterprise subscription could
    // still cost $0 and retain Free entitlements).
    const planPrice = priceFor(tier, billingCycle);
    const features = getFeatures(tier);
    let subscription = await Subscription.findOne({ seller: req.user._id, status: 'active' });
    
    if (subscription) {
      subscription.tier = tier;
      subscription.billingCycle = billingCycle;
      subscription.price = planPrice;
      subscription.features = features;
    } else {
      subscription = await Subscription.create({
        seller: req.user._id,
        tier,
        billingCycle,
        price: planPrice,
        features,
      });
    }
    
    await subscription.save();
    
    res.json(subscription);
  } catch (error) {
    res.status(500).json({ message: 'Failed to subscribe' });
  }
});

// POST /api/subscriptions/cancel - Cancel subscription
router.post('/cancel', auth, async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ seller: req.user._id, status: 'active' });
    
    if (!subscription) {
      return res.status(404).json({ message: 'No active subscription found' });
    }
    
    subscription.status = 'cancelled';
    await subscription.save();
    
    res.json({ message: 'Subscription cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to cancel subscription' });
  }
});

function getFeatures(tier) {
  const features = {
    reducedFees: tier !== 'free',
    prioritySupport: tier === 'pro' || tier === 'enterprise',
    enhancedPromotions: tier === 'pro' || tier === 'enterprise',
    analyticsAccess: tier !== 'free',
    customDomain: tier === 'enterprise',
  };
  return features;
}

module.exports = router;
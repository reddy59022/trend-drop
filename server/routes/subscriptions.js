const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Subscription = require('../models/Subscription');

// GET /api/subscriptions/plans - Get available subscription plans
router.get('/plans', async (req, res) => {
  try {
    res.json([
      { id: 'free', name: 'Free', price: 0, features: { analyticsAccess: false, reducedFees: false } },
      { id: 'basic', name: 'Basic', price: 9.99, features: { reducedFees: true, analyticsAccess: true, prioritySupport: false } },
      { id: 'pro', name: 'Pro', price: 29.99, features: { reducedFees: true, analyticsAccess: true, prioritySupport: true, enhancedPromotions: true } },
      { id: 'enterprise', name: 'Enterprise', price: 99.99, features: { reducedFees: true, analyticsAccess: true, prioritySupport: true, enhancedPromotions: true, customDomain: true } },
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
    const { tier, billingCycle } = req.body;
    
    if (!['basic', 'pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ message: 'Invalid tier' });
    }
    
    let subscription = await Subscription.findOne({ seller: req.user._id, status: 'active' });
    
    if (subscription) {
      subscription.tier = tier;
      subscription.billingCycle = billingCycle;
    } else {
      subscription = await Subscription.create({
        seller: req.user._id,
        tier,
        billingCycle,
        price: tier === 'basic' ? 9.99 : tier === 'pro' ? 29.99 : 99.99,
        features: getFeatures(tier),
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
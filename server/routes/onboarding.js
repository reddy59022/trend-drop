const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');

// GET /api/users/me/onboarding - Get current user's onboarding status (mounted at /api/users/me)
router.get('/onboarding', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('onboarding');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize onboarding if not exists
    if (!user.onboarding) {
      user.onboarding = {
        completed: false,
        currentStep: 0,
        steps: {
          profileSetup: { completed: false, completedAt: null },
          firstListing: { completed: false, completedAt: null },
          shippingSetup: { completed: false, completedAt: null },
          paymentSetup: { completed: false, completedAt: null },
          tipsReview: { completed: false, completedAt: null },
        },
      };
      await user.save();
    }

    res.json({ 
      onboarding: user.onboarding || {
        completed: false,
        currentStep: 0,
        steps: {
          profileSetup: { completed: false, completedAt: null },
          firstListing: { completed: false, completedAt: null },
          shippingSetup: { completed: false, completedAt: null },
          paymentSetup: { completed: false, completedAt: null },
          tipsReview: { completed: false, completedAt: null },
        },
      }
    });
  } catch (error) {
    console.error('Get onboarding error:', error);
    res.status(500).json({ message: 'Error fetching onboarding status' });
  }
});

// POST /api/users/me/onboarding/complete-step - Mark a step as complete
router.post('/onboarding/complete-step', auth, async (req, res) => {
  try {
    const { step } = req.body;

    if (!step) {
      return res.status(400).json({ message: 'Step name is required' });
    }

    const validSteps = ['profileSetup', 'firstListing', 'shippingSetup', 'paymentSetup', 'tipsReview'];
    if (!validSteps.includes(step)) {
      return res.status(400).json({ message: `Invalid step: ${step}. Valid steps: ${validSteps.join(', ')}` });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize onboarding if not exists
    if (!user.onboarding) {
      user.onboarding = {
        completed: false,
        currentStep: 0,
        steps: {
          profileSetup: { completed: false, completedAt: null },
          firstListing: { completed: false, completedAt: null },
          shippingSetup: { completed: false, completedAt: null },
          paymentSetup: { completed: false, completedAt: null },
          tipsReview: { completed: false, completedAt: null },
        },
      };
    }

    // Mark step as complete
    user.onboarding.steps[step] = {
      completed: true,
      completedAt: new Date(),
    };

    // Count completed steps
    const completedSteps = Object.values(user.onboarding.steps).filter(s => s.completed).length;
    user.onboarding.currentStep = completedSteps;

    // Check if all steps complete
    user.onboarding.completed = completedSteps === validSteps.length;
    if (user.onboarding.completed) {
      user.onboarding.completedAt = new Date();
    }

    await user.save();

    // Fetch fresh data
    const updatedUser = await User.findById(req.user._id).select('onboarding');
    
    res.json({ 
      onboarding: updatedUser.onboarding || {
        completed: false,
        currentStep: 0,
        steps: {
          profileSetup: { completed: false, completedAt: null },
          firstListing: { completed: false, completedAt: null },
          shippingSetup: { completed: false, completedAt: null },
          paymentSetup: { completed: false, completedAt: null },
          tipsReview: { completed: false, completedAt: null },
        },
      }
    });
  } catch (error) {
    console.error('Complete step error:', error);
    res.status(500).json({ message: 'Error completing onboarding step' });
  }
});

// GET /api/users/me/onboarding/progress - Get onboarding progress percentage
router.get('/onboarding/progress', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('onboarding');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Initialize onboarding if not exists
    if (!user.onboarding) {
      return res.json({ progress: 0 });
    }

    if (user.onboarding.completed) {
      return res.json({ progress: 100 });
    }

    const totalSteps = 5;
    const completedSteps = Object.values(user.onboarding.steps || {}).filter(s => s.completed).length;
    const progress = Math.round((completedSteps / totalSteps) * 100);

    res.json({ progress });
  } catch (error) {
    console.error('Get progress error:', error);
    res.status(500).json({ message: 'Error fetching onboarding progress' });
  }
});

// POST /api/users/me/onboarding/reset - Reset onboarding
router.post('/onboarding/reset', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.onboarding = {
      completed: false,
      currentStep: 0,
      steps: {
        profileSetup: { completed: false, completedAt: null },
        firstListing: { completed: false, completedAt: null },
        shippingSetup: { completed: false, completedAt: null },
        paymentSetup: { completed: false, completedAt: null },
        tipsReview: { completed: false, completedAt: null },
      },
    };

    await user.save();

    res.json({ onboarding: user.onboarding });
  } catch (error) {
    console.error('Reset onboarding error:', error);
    res.status(500).json({ message: 'Error resetting onboarding' });
  }
});

// GET /api/onboarding/tips - Get onboarding tips
router.get('/tips', auth, (req, res) => {
  try {
    const tips = [
      // Photography tips
      {
        id: 1,
        category: 'photography',
        title: 'Use Natural Light',
        description: 'Take photos near windows or outside during golden hour for best results.',
        icon: 'camera',
      },
      {
        id: 2,
        category: 'photography',
        title: 'Show Multiple Angles',
        description: 'Include front, back, side, and detail shots to build buyer confidence.',
        icon: 'camera',
      },
      {
        id: 3,
        category: 'photography',
        title: 'Use a Clean Background',
        description: 'White walls or bedsheets work great. Avoid cluttered backgrounds.',
        icon: 'camera',
      },
      // Pricing tips
      {
        id: 4,
        category: 'pricing',
        title: 'Research Comparable Items',
        description: 'Check what similar items sold for on TrendDrop and other platforms.',
        icon: 'dollar',
      },
      {
        id: 5,
        category: 'pricing',
        title: 'Price competitively',
        description: 'Start slightly lower than retail to attract quick buyers.',
        icon: 'dollar',
      },
      {
        id: 6,
        category: 'pricing',
        title: 'Consider Offering Negotiation',
        description: 'Enable offers to increase buyer interest and engagement.',
        icon: 'dollar',
      },
      // Shipping tips
      {
        id: 7,
        category: 'shipping',
        title: 'Offer Free Shipping',
        description: 'Factor shipping cost into your price to attract more buyers.',
        icon: 'truck',
      },
      {
        id: 8,
        category: 'shipping',
        title: 'Ship Quickly',
        description: 'Same-day or next-day shipping gets you 5-star reviews.',
        icon: 'truck',
      },
      {
        id: 9,
        category: 'shipping',
        title: 'Use Tracking',
        description: 'Always include tracking to protect yourself and build trust.',
        icon: 'truck',
      },
    ];

    res.json({ tips });
  } catch (error) {
    console.error('Get tips error:', error);
    res.status(500).json({ message: 'Error fetching tips' });
  }
});

// GET /api/onboarding/checklist - Get onboarding checklist
router.get('/checklist', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('onboarding');
    
    const checklist = [
      {
        step: 'profileSetup',
        title: 'Complete Your Profile',
        description: 'Add a photo and bio so buyers trust you',
        icon: 'user',
        completed: user?.onboarding?.steps?.profileSetup?.completed || false,
      },
      {
        step: 'firstListing',
        title: 'List Your First Item',
        description: 'Create your first listing with photos and description',
        icon: 'tag',
        completed: user?.onboarding?.steps?.firstListing?.completed || false,
      },
      {
        step: 'shippingSetup',
        title: 'Set Up Shipping',
        description: 'Configure your shipping preferences',
        icon: 'truck',
        completed: user?.onboarding?.steps?.shippingSetup?.completed || false,
      },
      {
        step: 'paymentSetup',
        title: 'Add Payment Method',
        description: 'Connect Stripe or PayPal to receive payments',
        icon: 'credit',
        completed: user?.onboarding?.steps?.paymentSetup?.completed || false,
      },
      {
        step: 'tipsReview',
        title: 'Review Seller Tips',
        description: 'Learn best practices for successful selling',
        icon: 'book',
        completed: user?.onboarding?.steps?.tipsReview?.completed || false,
      },
    ];

    res.json({ checklist });
  } catch (error) {
    console.error('Get checklist error:', error);
    res.status(500).json({ message: 'Error fetching checklist' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const SellerCommunity = require('../models/SellerCommunity');
const crypto = require('crypto');

// GET /api/seller-communities - Get all communities
router.get('/', auth, async (req, res) => {
  try {
    const communities = await SellerCommunity.find({ isPrivate: false })
      .populate('members', 'name')
      .populate('moderators', 'name')
      .limit(50);
    res.json(communities);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch communities' });
  }
});

// POST /api/seller-communities - Create new community
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, isPrivate } = req.body;
    
    const inviteCode = crypto.randomBytes(6).toString('hex').toUpperCase();
    
    const community = await SellerCommunity.create({
      name,
      description,
      isPrivate: isPrivate || false,
      inviteCode,
      members: [req.user._id],
      moderators: [req.user._id]
    });

    res.status(201).json(community);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create community' });
  }
});

// GET /api/seller-communities/:id - Get single community
router.get('/:id', auth, async (req, res) => {
  try {
    const community = await SellerCommunity.findById(req.params.id)
      .populate('members', 'name avatar')
      .populate('moderators', 'name');
    
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }

    res.json(community);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch community' });
  }
});

// POST /api/seller-communities/:id/join - Join a community
router.post('/:id/join', auth, async (req, res) => {
  try {
    const { inviteCode } = req.body;
    const community = await SellerCommunity.findById(req.params.id);
    
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }

    if (community.isPrivate && community.inviteCode !== inviteCode) {
      return res.status(403).json({ message: 'Invalid invite code' });
    }

    if (!community.members.includes(req.user._id)) {
      community.members.push(req.user._id);
      await community.save();
    }

    res.json(community);
  } catch (error) {
    res.status(500).json({ message: 'Failed to join community' });
  }
});

// POST /api/seller-communities/:id/challenges - Create challenge
router.post('/:id/challenges', auth, async (req, res) => {
  try {
    const { title, description, endDate, rewards } = req.body;
    
    const community = await SellerCommunity.findById(req.params.id);
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }

    if (!community.moderators.includes(req.user._id)) {
      return res.status(403).json({ message: 'Only moderators can create challenges' });
    }

    community.challenges.push({ title, description, endDate, rewards });
    await community.save();

    res.json(community);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create challenge' });
  }
});

// POST /api/seller-communities/:id/achievements - Award achievement
router.post('/:id/achievements', auth, async (req, res) => {
  try {
    const { memberId, badge } = req.body;
    
    const community = await SellerCommunity.findById(req.params.id);
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }

    if (!community.moderators.includes(req.user._id)) {
      return res.status(403).json({ message: 'Only moderators can award achievements' });
    }

    community.achievements.push({ member: memberId, badge });
    await community.save();

    res.json(community);
  } catch (error) {
    res.status(500).json({ message: 'Failed to award achievement' });
  }
});

// GET /api/seller-communities/:id/leaderboard - Get community leaderboard
router.get('/:id/leaderboard', auth, async (req, res) => {
  try {
    const community = await SellerCommunity.findById(req.params.id)
      .populate('members', 'name')
      .populate('achievements.member', 'name');
    
    if (!community) {
      return res.status(404).json({ message: 'Community not found' });
    }

    const leaderboard = community.members.map(member => ({
      member,
      achievements: community.achievements.filter(a => a.member._id.equals(member._id)).length
    })).sort((a, b) => b.achievements - a.achievements);

    res.json(leaderboard);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch leaderboard' });
  }
});

module.exports = router;
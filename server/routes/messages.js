const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const Offer = require('../models/Offer');
const { auth } = require('../middleware/auth');
const pushService = require('../services/pushService');

// POST /api/messages - Start a conversation about a listing
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, sellerId, recipientId, text } = req.body;
    const targetUserId = sellerId || recipientId;
    if (!text) return res.status(400).json({ message: 'Message text is required' });
    if (!targetUserId) return res.status(400).json({ message: 'Recipient is required' });
    if (req.user._id.toString() === targetUserId) {
      return res.status(400).json({ message: 'Cannot message yourself' });
    }
    let conversation = await Message.findOne({
      participants: { $all: [req.user._id, targetUserId] },
      listing: listingId,
    });
    if (conversation) {
      conversation.messages.push({ sender: req.user._id, text });
    } else {
      conversation = await Message.create({
        participants: [req.user._id, targetUserId],
        listing: listingId,
        messages: [{ sender: req.user._id, text }],
      });
    }
    await conversation.save();
    await conversation.populate([
      { path: 'participants', select: 'name avatar' },
      { path: 'listing', select: 'title images price currency' },
      { path: 'messages.sender', select: 'name avatar' },
    ]);

    // TD-2.3: push the recipient so time-sensitive deals aren't missed.
    // Fire-and-forget safe: pushService never throws and is fully key-gated.
    await pushService.sendToUser(targetUserId, {
      category: 'messages',
      title: `New message from ${req.user.name}`,
      body: text,
      data: { type: 'message', conversationId: conversation._id.toString(), listingId: listingId.toString() },
    });

    res.status(201).json(conversation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/messages/conversations - Get all user conversations
router.get('/conversations', auth, async (req, res) => {
  try {
    const conversations = await Message.find({ participants: req.user._id })
      .populate('participants', 'name avatar')
      .populate('listing', 'title images price')
      .populate('messages.sender', 'name avatar')
      .sort({ updatedAt: -1 });

    const result = conversations.map(c => {
      const lastMsg = c.messages[c.messages.length - 1];
      const unread = c.messages.filter(m => !m.read && m.sender._id.toString() !== req.user._id.toString()).length;
      const otherUser = c.participants.find(p => p._id.toString() !== req.user._id.toString());
      return { _id: c._id, listing: c.listing, otherUser, lastMessage: lastMsg, unreadCount: unread, updatedAt: c.updatedAt };
    });
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/messages/conversation/:userId/:listingId
router.get('/conversation/:userId/:listingId', auth, async (req, res) => {
  try {
    const conversation = await Message.findOne({
      participants: { $all: [req.user._id, req.params.userId] },
      listing: req.params.listingId,
    }).populate('participants', 'name avatar')
      .populate('listing', 'title images price currency')
      .populate('messages.sender', 'name avatar');
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    
    // Attach active offer for this listing between these users
    const activeOffer = await Offer.findOne({
      listing: req.params.listingId,
      $or: [
        { buyer: req.user._id, seller: req.params.userId },
        { buyer: req.params.userId, seller: req.user._id },
      ],
      status: { $in: ['pending', 'countered', 'buyer_countered', 'accepted'] },
    }).sort({ updatedAt: -1 });
    
    const result = conversation.toObject();
    if (activeOffer) {
      result.offer = activeOffer.toObject();
      // Auto-expire offers past their 24h window
      const now = new Date();
      if (activeOffer.expiresAt && now > activeOffer.expiresAt && 
          (activeOffer.status === 'pending' || activeOffer.status === 'countered' || activeOffer.status === 'buyer_countered')) {
        activeOffer.status = 'expired';
        await activeOffer.save();
        result.offer.status = 'expired';
      }
    }
    
    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PUT /api/messages/read/:conversationId
router.put('/read/:conversationId', auth, async (req, res) => {
  try {
    const conversation = await Message.findById(req.params.conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    conversation.messages.forEach(m => {
      if (m.sender.toString() !== req.user._id.toString()) m.read = true;
    });
    await conversation.save();
    res.json({ message: 'Messages marked as read' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// POST /api/messages/:conversationId - Send reply
router.post('/:conversationId', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ message: 'Message text is required' });
    const conversation = await Message.findById(req.params.conversationId);
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    conversation.messages.push({ sender: req.user._id, text });
    await conversation.save();
    await conversation.populate('messages.sender', 'name avatar');

    // TD-2.3: push the other participant on every reply.
    const recipientId = conversation.participants.find(
      (p) => p.toString() !== req.user._id.toString()
    );
    if (recipientId) {
      await pushService.sendToUser(recipientId, {
        category: 'messages',
        title: `New message from ${req.user.name}`,
        body: text,
        data: {
          type: 'message',
          conversationId: conversation._id.toString(),
          listingId: conversation.listing ? conversation.listing.toString() : '',
        },
      });
    }

    res.json(conversation.messages);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
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
    const created = !conversation;
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

    // 201 only when a NEW conversation is created; 200 when appending to an
    // existing thread (REST semantics — callers can distinguish the two).
    res.status(created ? 201 : 200).json(conversation);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/messages/conversations - Get all user conversations grouped by person
router.get('/conversations', auth, async (req, res) => {
  try {
    const conversations = await Message.find({ participants: req.user._id })
      .populate('participants', 'name avatar')
      .populate('listing', 'title images price currency')
      .populate('messages.sender', 'name avatar')
      .sort({ updatedAt: -1 });

    // Group conversations by the other user (not by listing)
    const groupedByUser = {};
    
    conversations.forEach(c => {
      const otherUser = c.participants.find(p => p && p._id && p._id.toString() !== req.user._id.toString());
      if (!otherUser) return;
      
      const otherUserId = otherUser._id.toString();
      
      if (!groupedByUser[otherUserId]) {
        groupedByUser[otherUserId] = {
          _id: c._id, // Use the most recent conversation ID
          otherUser: otherUser,
          conversations: [],
          lastMessage: null,
          unreadCount: 0,
          updatedAt: c.updatedAt,
          listing: c.listing,
          listings: []
        };
      }
      
      const group = groupedByUser[otherUserId];
      
      // Add this conversation to the group
      group.conversations.push(c);
      
      // Track the most recent message across all conversations
      const lastMsg = c.messages[c.messages.length - 1];
      if (lastMsg && (!group.lastMessage || new Date(lastMsg.createdAt) > new Date(group.lastMessage.createdAt))) {
        group.lastMessage = lastMsg;
        group.updatedAt = c.updatedAt;
        group._id = c._id;
        group.listing = c.listing; // Listing context of the latest message
      }
      
      // Sum up unread counts (sender may be a deleted user → fall back to raw id)
      const unread = c.messages.filter(m => {
        if (m.read) return false;
        const senderId = m.sender && m.sender._id ? m.sender._id.toString() : String(m.sender);
        return senderId !== req.user._id.toString();
      }).length;
      group.unreadCount += unread;
      
      // Track listings
      if (c.listing && !group.listings.find(l => l._id.toString() === c.listing._id.toString())) {
        group.listings.push(c.listing);
      }
    });

    // Convert to array and sort by most recent activity
    const result = Object.values(groupedByUser)
      .map(g => ({
        ...g,
        // UI helpers: how many items are discussed in this thread and total
        // message count, so the list can show "Re: X +1 more item".
        listingCount: g.listings.length,
        messageCount: g.conversations.reduce((sum, c) => sum + c.messages.length, 0),
      }))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/messages/conversation/:userId - Get ALL messages with a user (across all listings)
router.get('/conversation/:userId', auth, async (req, res) => {
  try {
    const conversations = await Message.find({
      participants: { $all: [req.user._id, req.params.userId] },
    })
      .populate('participants', 'name avatar')
      .populate('listing', 'title images price currency')
      .populate('messages.sender', 'name avatar')
      .sort({ updatedAt: 1 }); // Oldest first for chronological order

    if (!conversations.length) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Combine all messages from all conversations with this user
    const otherUser = conversations[0].participants.find(
      p => p && p._id && p._id.toString() !== req.user._id.toString()
    );

    const allMessages = [];
    const allListings = [];
    const offers = [];

    for (const conv of conversations) {
      // Deleted listings must not break the unified thread — skip that
      // conversation but keep the rest of the thread intact.
      if (!conv.listing) continue;

      // Add messages with listing context
      conv.messages.forEach(msg => {
        allMessages.push({
          ...msg.toObject(),
          listing: conv.listing,
          conversationId: conv._id
        });
      });

      // Track listings
      if (conv.listing && !allListings.find(l => l._id.toString() === conv.listing._id.toString())) {
        allListings.push(conv.listing);
      }

      // Get offers for this listing
      const offer = await Offer.findOne({
        listing: conv.listing._id || conv.listing,
        $or: [
          { buyer: req.user._id, seller: req.params.userId },
          { buyer: req.params.userId, seller: req.user._id },
        ],
      }).sort({ updatedAt: -1 });

      if (offer) {
        // Auto-expire if needed
        const now = new Date();
        if (offer.expiresAt && now > offer.expiresAt && 
            (offer.status === 'pending' || offer.status === 'countered' || offer.status === 'buyer_countered')) {
          offer.status = 'expired';
          await offer.save();
        }
        const listingPlain = typeof conv.listing.toObject === 'function' ? conv.listing.toObject() : conv.listing;
        offers.push({ ...offer.toObject(), listing: listingPlain });
      }
    }

    // Sort messages chronologically
    allMessages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    // Mark all messages as read
    for (const conv of conversations) {
      let hasUnread = false;
      conv.messages.forEach(m => {
        if (m.sender.toString() !== req.user._id.toString() && !m.read) {
          m.read = true;
          hasUnread = true;
        }
      });
      if (hasUnread) await conv.save();
    }

    res.json({
      _id: conversations[conversations.length - 1]._id,
      otherUser,
      messages: allMessages,
      listings: allListings,
      offers: offers,
      conversationIds: conversations.map(c => c._id)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/messages/conversation/:userId/:listingId - Get messages for specific listing (legacy support)
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
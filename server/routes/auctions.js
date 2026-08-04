const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Auction = require('../models/Auction');
const Listing = require('../models/Listing');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

// ===================== AUCTION/BIDDING SYSTEM =====================
// Timed bidding auctions with reserve prices and automatic closing

// GET /api/auctions/settings - Get auction configuration (MUST be before /:id route)
router.get('/settings', (req, res) => {
  res.json({
    minBidIncrement: 1, // USD
    maxAuctionDuration: 30, // days
    minAuctionDuration: 1, // day
    maxImagesPerAuction: 10,
    currency: 'USD',
  });
});

// POST /api/auctions - Create auction for a listing
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, startTime, endTime, reservePrice, currency } = req.body;
    
    if (!listingId || !startTime || !endTime) {
      return res.status(400).json({ message: 'listingId, startTime, and endTime are required' });
    }
    
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    
    // Only seller can create auction for their listing
    if (String(listing.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only seller can create auction for their listing' });
    }
    
    // Validate times
    if (new Date(endTime) <= new Date(startTime)) {
      return res.status(400).json({ message: 'end time must be after start time' });
    }
    
    // Check if auction already exists for this listing
    const existingAuction = await Auction.findOne({ listing: listingId });
    if (existingAuction) {
      return res.status(400).json({ message: 'Auction already exists for this listing' });
    }
    
    // Use listing currency if not provided, otherwise validate it matches listing
    const auctionCurrency = (currency || listing.currency || 'USD').toUpperCase();
    
    const auction = await Auction.create({
      listing: listingId,
      seller: req.user._id,
      startTime,
      endTime,
      reservePrice: reservePrice || listing.price,
      currency: auctionCurrency,
      currentBid: reservePrice || listing.price,
      status: new Date(startTime) <= new Date() ? 'active' : 'scheduled',
    });
    
    res.status(201).json({ auction });
  } catch (error) {
    console.error('Create auction error:', error);
    res.status(500).json({ message: 'Failed to create auction' });
  }
});

// GET /api/auctions - List auctions with optional filtering
router.get('/', async (req, res) => {
  try {
    const { status, limit = 20, skip = 0 } = req.query;
    
    const query = {};
    if (status) query.status = status;
    
    const auctions = await Auction.find(query)
      .populate('listing', 'title price images')
      .populate('seller', 'name')
      .sort({ endTime: 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));
    
    res.json({ auctions });
  } catch (error) {
    console.error('Get auctions error:', error);
    res.status(500).json({ message: 'Failed to fetch auctions' });
  }
});

// GET /api/auctions/:id - Get single auction details
router.get('/:id', async (req, res) => {
  try {
    const auction = await Auction.findById(req.params.id)
      .populate('listing', 'title price images description')
      .populate('seller', 'name')
      .populate('bids.bidder', 'name');
    
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }
    
    res.json({ auction });
  } catch (error) {
    console.error('Get auction error:', error);
    res.status(500).json({ message: 'Failed to fetch auction' });
  }
});

// POST /api/auctions/:id/bids - Place bid on auction
router.post('/:id/bids', auth, async (req, res) => {
  try {
    const { amount, currency } = req.body;
    const auctionId = req.params.id;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid bid amount is required' });
    }
    
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }
    
    // Prevent self-bidding: seller cannot bid on their own auction
    if (String(auction.seller) === String(req.user._id)) {
      return res.status(403).json({ message: 'Sellers cannot bid on their own auctions' });
    }
    
    // Check auction is active
    if (auction.status !== 'active') {
      return res.status(400).json({ message: 'Auction is not active' });
    }
    
    // Check auction hasn't ended
    if (new Date() > auction.endTime) {
      return res.status(400).json({ message: 'Auction has ended' });
    }
    
    // Check bid is higher than current bid
    const minBid = auction.currentBid + 1;
    if (amount < minBid) {
      return res.status(400).json({ message: `Bid must be higher than current bid of ${auction.currentBid}` });
    }
    
    // Check bid meets reserve price (if there's no current bid above reserve)
    if (auction.currentBid <= auction.reservePrice && amount < auction.reservePrice) {
      return res.status(400).json({ message: `Bid must meet reserve price of ${auction.reservePrice}` });
    }
    
    // Validate currency matches auction currency
    const bidCurrency = currency || auction.currency || 'USD';
    if (currency && currency !== (auction.currency || 'USD')) {
      return res.status(400).json({ message: 'Bid currency must match auction currency' });
    }
    
    // Add bid
    auction.bids.push({
      bidder: req.user._id,
      amount,
      currency: bidCurrency,
      timestamp: new Date(),
    });
    auction.currentBid = amount;
    
    await auction.save();
    
    // Notify seller of new bid (non-critical: a notification failure must never
    // prevent a valid bid from being accepted)
    try {
      const seller = await User.findById(auction.seller);
      if (seller) {
        seller.notifications.unshift({
          type: 'sale',
          listing: auction.listing,
          message: `New bid of ${bidCurrency} ${amount} placed on your auction!`,
        });
        await seller.save();
      }
    } catch (notifErr) {
      console.error('Failed to notify seller of bid:', notifErr.message);
    }
    
    const populatedAuction = await Auction.findById(auctionId).populate('bids.bidder', 'name');
    
    res.json({ auction: populatedAuction });
  } catch (error) {
    console.error('Place bid error:', error);
    res.status(500).json({ message: 'Failed to place bid' });
  }
});

// POST /api/auctions/:id/close - Close expired auction (seller/admin only)
router.post('/:id/close', auth, async (req, res) => {
  try {
    const auction = await Auction.findById(req.params.id);
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }
    
    // Only seller or admin can close
    const user = await User.findById(req.user._id);
    if (String(auction.seller) !== String(req.user._id) && user.role !== 'admin') {
      return res.status(403).json({ message: 'Only seller or admin can close auction' });
    }
    
    // Check auction has ended
    if (new Date() <= auction.endTime) {
      return res.status(400).json({ message: 'Auction has not ended yet' });
    }
    
    // Determine winner
    if (auction.bids.length > 0 && auction.currentBid >= auction.reservePrice) {
      const highestBid = auction.bids.reduce((max, bid) => bid.amount > max.amount ? bid : max, auction.bids[0]);
      auction.winner = highestBid.bidder;
      auction.winningBid = highestBid.amount;
    }
    
    auction.status = 'closed';
    await auction.save();
    
    // Update listing if sold
    if (auction.winner) {
      await Listing.findByIdAndUpdate(auction.listing, {
        sold: true,
        available: false,
      });
    }
    
    res.json({ auction });
  } catch (error) {
    console.error('Close auction error:', error);
    res.status(500).json({ message: 'Failed to close auction' });
  }
});

// POST /api/auctions/:id/stream/start - Start live stream (seller only)
router.post('/:id/stream/start', auth, async (req, res) => {
  try {
    const auction = await Auction.findById(req.params.id);
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }
    
    // Only seller can start stream
    if (String(auction.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only seller can start stream' });
    }
    
    // Check auction is active
    if (auction.status !== 'active') {
      return res.status(400).json({ message: 'Auction is not active' });
    }
    
    const { streamId } = req.body;
    
    // Store stream info for viewers to connect via WebRTC signaling
    auction.streamInfo = {
      streamId: streamId || `auction-${auction._id}-${Date.now()}`,
      sellerId: req.user._id,
      startedAt: new Date(),
      isLive: true,
      viewerCount: 0,
    };
    
    await auction.save();
    
    // In production, you would:
    // 1. Notify connected viewers via WebSocket
    // 2. Initialize SFU/media server session
    // 3. Return ICE servers and signaling info
    
    res.json({ 
      streamInfo: auction.streamInfo,
      // Signaling server info for WebRTC
      signaling: {
        // In production, return your media server connection details
        // e.g., mediasoup router, LiveKit room, etc.
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });
  } catch (error) {
    console.error('Start stream error:', error);
    res.status(500).json({ message: 'Failed to start stream' });
  }
});

// POST /api/auctions/:id/stream/stop - Stop live stream (seller only)
router.post('/:id/stream/stop', auth, async (req, res) => {
  try {
    const auction = await Auction.findById(req.params.id);
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }
    
    // Only seller can stop stream
    if (String(auction.seller) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only seller can stop stream' });
    }
    
    if (auction.streamInfo) {
      auction.streamInfo.isLive = false;
      auction.streamInfo.endedAt = new Date();
      await auction.save();
    }
    
    // In production, notify viewers via WebSocket to disconnect
    
    res.json({ message: 'Stream stopped', streamInfo: auction.streamInfo });
  } catch (error) {
    console.error('Stop stream error:', error);
    res.status(500).json({ message: 'Failed to stop stream' });
  }
});

// GET /api/auctions/:id/stream - Get stream info for viewers
router.get('/:id/stream', async (req, res) => {
  try {
    const auction = await Auction.findById(req.params.id);
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }
    
    if (!auction.streamInfo || !auction.streamInfo.isLive) {
      return res.status(404).json({ message: 'No active stream' });
    }
    
    // Increment viewer count
    auction.streamInfo.viewerCount = (auction.streamInfo.viewerCount || 0) + 1;
    await auction.save();
    
    res.json({ 
      streamInfo: auction.streamInfo,
      signaling: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    });
  } catch (error) {
    console.error('Get stream error:', error);
    res.status(500).json({ message: 'Failed to get stream info' });
  }
});

// POST /api/auctions/:id/close - Close expired auction with order creation (seller/admin only)
router.post('/:id/close', auth, async (req, res) => {
  try {
    const auction = await Auction.findById(req.params.id).populate('listing').populate('seller');
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
    }
    
    // Only seller or admin can close
    const user = await User.findById(req.user._id);
    if (String(auction.seller._id) !== String(req.user._id) && user.role !== 'admin') {
      return res.status(403).json({ message: 'Only seller or admin can close auction' });
    }
    
    // Check auction has ended
    if (new Date() <= auction.endTime) {
      return res.status(400).json({ message: 'Auction has not ended yet' });
    }
    
    // Determine winner
    let winner = null;
    let winningBid = 0;
    let winningCurrency = auction.currency || 'USD';
    
    if (auction.bids.length > 0 && auction.currentBid >= auction.reservePrice) {
      const highestBid = auction.bids.reduce((max, bid) => bid.amount > max.amount ? bid : max, auction.bids[0]);
      winner = highestBid.bidder;
      winningBid = highestBid.amount;
      winningCurrency = highestBid.currency || auction.currency || 'USD';
    }
    
    auction.winner = winner;
    auction.winningBid = winningBid;
    auction.winningCurrency = winningCurrency;
    auction.status = 'closed';
    
    // Stop any active stream
    if (auction.streamInfo) {
      auction.streamInfo.isLive = false;
      auction.streamInfo.endedAt = new Date();
    }
    
    await auction.save();
    
    // Update listing if sold
    if (winner) {
      await Listing.findByIdAndUpdate(auction.listing._id, {
        sold: true,
        available: false,
      });
      
      // Create transaction/order server-side (enterprise standard)
      const listing = await Listing.findById(auction.listing._id).populate('seller');
      
      // Calculate fees
      const platformFeePercent = 8; // 8% platform fee
      const platformFee = Math.round(winningBid * platformFeePercent / 100 * 100) / 100;
      const sellerEarnings = Math.round((winningBid - platformFee) * 100) / 100;
      
      // Create transaction record
      const transaction = await Transaction.create({
        buyer: winner,
        seller: listing.seller._id,
        listing: listing._id,
        auction: auction._id,
        amount: winningBid,
        platformFee,
        sellerEarnings,
        status: 'pending_payment', // Winner needs to pay
        paymentStatus: 'pending',
        shippingAddress: null, // Will be collected during checkout
      });
      
      // Notify winner
      const winnerUser = await User.findById(winner);
      if (winnerUser) {
        winnerUser.notifications.unshift({
          type: 'purchase',
          listing: listing._id,
          transaction: transaction._id,
          message: `Congratulations! You won the auction for "${listing.title}" with a bid of $${winningBid}. Please complete payment.`,
        });
        await winnerUser.save();
      }
      
      // Notify seller
      const sellerUser = await User.findById(listing.seller._id);
      if (sellerUser) {
        sellerUser.notifications.unshift({
          type: 'sale',
          listing: listing._id,
          transaction: transaction._id,
          message: `Your auction for "${listing.title}" ended! Winner bid $${winningBid}. You'll earn $${sellerEarnings} after fees.`,
        });
        await sellerUser.save();
      }
      
      // Return auction with transaction info
      const populatedAuction = await Auction.findById(auction._id)
        .populate('listing', 'title price images')
        .populate('seller', 'name')
        .populate('winner', 'name')
        .populate('bids.bidder', 'name');
      
      res.json({ 
        auction: populatedAuction,
        transaction: {
          _id: transaction._id,
          amount: transaction.amount,
          platformFee: transaction.platformFee,
          sellerEarnings: transaction.sellerEarnings,
          status: transaction.status,
        },
      });
    } else {
      // No winner - reserve not met or no bids
      res.json({ 
        auction,
        message: 'Auction closed without a winner (reserve price not met or no bids)',
      });
    }
  } catch (error) {
    console.error('Close auction error:', error);
    res.status(500).json({ message: 'Failed to close auction' });
  }
});

module.exports = router;

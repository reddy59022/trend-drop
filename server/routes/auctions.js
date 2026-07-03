const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Auction = require('../models/Auction');
const Listing = require('../models/Listing');
const User = require('../models/User');

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
    const { listingId, startTime, endTime, reservePrice } = req.body;
    
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
    
    const auction = await Auction.create({
      listing: listingId,
      seller: req.user._id,
      startTime,
      endTime,
      reservePrice: reservePrice || listing.price,
      status: new Date(startTime) <= new Date() ? 'active' : 'scheduled',
      currentBid: reservePrice || listing.price,
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
    const { amount } = req.body;
    const auctionId = req.params.id;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Valid bid amount is required' });
    }
    
    const auction = await Auction.findById(auctionId);
    if (!auction) {
      return res.status(404).json({ message: 'Auction not found' });
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
    
    // Add bid
    auction.bids.push({
      bidder: req.user._id,
      amount,
      timestamp: new Date(),
    });
    auction.currentBid = amount;
    
    await auction.save();
    
    // Notify seller of new bid
    const seller = await User.findById(auction.seller);
    if (seller) {
      seller.notifications.unshift({
        type: 'sale',
        listing: auction.listing,
        message: `New bid of ${amount} placed on your auction!`,
      });
      await seller.save();
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

module.exports = router;
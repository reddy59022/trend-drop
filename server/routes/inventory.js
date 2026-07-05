const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Inventory = require('../models/Inventory');
const Listing = require('../models/Listing');

// GET /api/inventory - Get all inventory items for seller
router.get('/', auth, async (req, res) => {
  try {
    const inventory = await Inventory.find({ seller: req.user._id })
      .populate('listing', 'title price images')
      .sort({ lastSync: -1 });
    res.json(inventory);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch inventory' });
  }
});

// GET /api/inventory/:id - Get single inventory item
router.get('/:id', auth, async (req, res) => {
  try {
    const item = await Inventory.findOne({ _id: req.params.id, seller: req.user._id })
      .populate('listing', 'title price images');
    
    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch inventory item' });
  }
});

// POST /api/inventory/sync - Sync inventory with warehouse
router.post('/sync', auth, async (req, res) => {
  try {
    const { warehouse, items } = req.body;
    
    // Simulate inventory sync
    const syncedItems = [];
    for (const item of items) {
      const inventory = await Inventory.findOneAndUpdate(
        { seller: req.user._id, listing: item.listingId },
        {
          seller: req.user._id,
          listing: item.listingId,
          warehouse,
          quantity: item.quantity || 0,
          location: item.location,
          sku: item.sku,
          lastSync: new Date()
        },
        { upsert: true, new: true }
      );
      syncedItems.push(inventory);
    }

    res.json(syncedItems);
  } catch (error) {
    console.error('Inventory sync error:', error);
    res.status(500).json({ message: 'Failed to sync inventory' });
  }
});

// POST /api/inventory/alerts - Set low stock alert
router.post('/alerts', auth, async (req, res) => {
  try {
    const lowStockItems = await Inventory.find({
      seller: req.user._id,
      $expr: { $lte: ['$quantity', '$lowStockThreshold'] }
    }).populate('listing', 'title');

    res.json({
      alerts: lowStockItems.map(item => ({
        listing: item.listing,
        quantity: item.quantity,
        threshold: item.lowStockThreshold
      }))
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to check stock alerts' });
  }
});

// PUT /api/inventory/:id/auto-reorder - Configure auto reorder
router.put('/:id/auto-reorder', auth, async (req, res) => {
  try {
    const { enabled, quantity, supplier } = req.body;
    
    const item = await Inventory.findOneAndUpdate(
      { _id: req.params.id, seller: req.user._id },
      { autoReorder: { enabled, quantity, supplier } },
      { new: true }
    );

    if (!item) {
      return res.status(404).json({ message: 'Inventory item not found' });
    }

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update auto reorder' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Listing = require('../models/Listing');
const multer = require('multer');
const csvParser = require('csv-parser');
const fs = require('fs');
const path = require('path');

// Multer for CSV file upload
const upload = multer({ dest: 'uploads/', limits: { fileSize: 5 * 1024 * 1024 } });

// ===================== BULK STATUS UPDATE =====================
// PATCH /api/listings/bulk-status - Update status for multiple listings
router.patch('/bulk-status', auth, async (req, res) => {
  try {
    const { listingIds, status } = req.body;
    
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ message: 'listingIds array is required' });
    }
    
    if (!['active', 'draft', 'sold'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be: active, draft, or sold' });
    }
    
    const update = { status };
    if (status === 'sold') {
      update.sold = true;
      update.available = false;
    } else if (status === 'active') {
      update.available = true;
      update.sold = false;
    }
    
    const result = await Listing.updateMany(
      { _id: { $in: listingIds }, seller: req.user._id },
      { $set: update }
    );
    
    res.json({
      success: true,
      modified: result.modifiedCount,
      status,
    });
  } catch (error) {
    console.error('Bulk status update error:', error);
    res.status(500).json({ message: 'Failed to update listing status' });
  }
});

// ===================== BULK PRICE UPDATE =====================
// PATCH /api/listings/bulk-price - Update price for multiple listings
router.patch('/bulk-price', auth, async (req, res) => {
  try {
    const { listingIds, price } = req.body;
    
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ message: 'listingIds array is required' });
    }
    
    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum < 5) {
      return res.status(400).json({ message: 'Price must be at least $5.00' });
    }
    
    const result = await Listing.updateMany(
      { _id: { $in: listingIds }, seller: req.user._id },
      { $set: { price: priceNum } }
    );
    
    res.json({
      success: true,
      modified: result.modifiedCount,
      price: priceNum,
    });
  } catch (error) {
    console.error('Bulk price update error:', error);
    res.status(500).json({ message: 'Failed to update listing prices' });
  }
});

// ===================== BULK DELETE =====================
// DELETE /api/listings/bulk - Delete multiple listings
router.delete('/bulk', auth, async (req, res) => {
  try {
    const { listingIds } = req.body;
    
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ message: 'listingIds array is required' });
    }
    
    // Only allow deleting draft or inactive listings, not sold ones
    const result = await Listing.deleteMany({
      _id: { $in: listingIds },
      seller: req.user._id,
      sold: false,
    });
    
    res.json({
      success: true,
      deleted: result.deletedCount,
    });
  } catch (error) {
    console.error('Bulk delete error:', error);
    res.status(500).json({ message: 'Failed to delete listings', error: error.message });
  }
});

// ===================== BULK BOOST ACTIVATION =====================
// POST /api/listings/bulk-boost - Activate boost for multiple listings
router.post('/bulk-boost', auth, async (req, res) => {
  try {
    const { listingIds, tier = 'standard', durationHours = 168 } = req.body;
    
    if (!listingIds || !Array.isArray(listingIds) || listingIds.length === 0) {
      return res.status(400).json({ message: 'listingIds array is required' });
    }
    
    const validTiers = ['standard', 'premium', 'elite'];
    if (!validTiers.includes(tier)) {
      return res.status(400).json({ message: `Invalid tier. Must be: ${validTiers.join(', ')}` });
    }
    
    const priorityScore = tier === 'standard' ? 100 : tier === 'premium' ? 150 : 200;
    
    const result = await Listing.updateMany(
      { _id: { $in: listingIds }, seller: req.user._id, available: true, sold: false },
      { 
        $set: { 
          'boost.active': true,
          'boost.tier': tier,
          'boost.startDate': new Date(),
          'boost.endDate': new Date(Date.now() + durationHours * 60 * 60 * 1000),
          'boost.durationDays': Math.floor(durationHours / 24),
          'boost.priorityScore': priorityScore,
        }
      }
    );
    
    res.json({
      success: true,
      boosted: result.modifiedCount,
      tier,
      durationHours,
    });
  } catch (error) {
    console.error('Bulk boost error:', error);
    res.status(500).json({ message: 'Failed to boost listings' });
  }
});

// ===================== CSV IMPORT =====================
// POST /api/listings/bulk-import - Import listings from CSV
router.post('/bulk-import', auth, upload.single('csv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'CSV file is required' });
    }
    
    const listings = [];
    const errors = [];
    
    // Parse CSV file
    await new Promise((resolve, reject) => {
      fs.createReadStream(req.file.path)
        .pipe(csvParser())
        .on('data', (row) => {
          // Validate required fields
          if (!row.title || !row.description || !row.price || !row.category || !row.condition) {
            errors.push(`Missing required fields in row: ${JSON.stringify(row)}`);
            return;
          }
          
          const price = parseFloat(row.price);
          if (isNaN(price) || price < 5) {
            errors.push(`Invalid price in row: ${row.title}`);
            return;
          }
          
          listings.push({
            title: row.title,
            description: row.description,
            price: price,
            category: row.category,
            condition: row.condition,
            size: row.size || '',
            weight: parseFloat(row.weight) || 0.5,
            images: row.images ? row.images.split(';').map(img => img.trim()).filter(img => img) : [],
            status: 'active',
            available: true,
            sold: false,
            seller: req.user._id,
            currency: req.user.currency || 'USD',
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    // Clean up uploaded file
    fs.unlinkSync(req.file.path);
    
    // Bulk create listings
    const created = await Listing.insertMany(listings);
    
    // Update user stats
    const User = require('../models/User');
    await User.findByIdAndUpdate(req.user._id, {
      $inc: { 'stats.totalListings': created.length }
    });
    
    res.json({
      success: true,
      imported: created.length,
      errors: errors.length,
      errorDetails: errors.slice(0, 5), // Return first 5 errors
    });
  } catch (error) {
    console.error('CSV import error:', error);
    // Clean up file on error
    if (req.file && req.file.path) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ message: 'Failed to import CSV', error: error.message });
  }
});

// ===================== BULK EXPORT =====================
// GET /api/listings/bulk-export - Export user's listings as CSV
router.get('/bulk-export', auth, async (req, res) => {
  try {
    const listings = await Listing.find({ seller: req.user._id })
      .select('title description price category condition size weight images createdAt')
      .lean();
    
    // Convert to CSV
    const headers = ['title', 'description', 'price', 'category', 'condition', 'size', 'weight', 'images'];
    let csv = headers.join(',') + '\n';
    
    listings.forEach(listing => {
      const row = headers.map(h => {
        let val = listing[h] || '';
        if (h === 'images' && Array.isArray(val)) {
          val = val.join(';');
        }
        // Escape quotes and commas
        if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csv += row.join(',') + '\n';
    });
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="trenddrop-listings-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Bulk export error:', error);
    res.status(500).json({ message: 'Failed to export listings' });
  }
});

module.exports = router;
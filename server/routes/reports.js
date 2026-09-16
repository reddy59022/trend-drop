const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const { auth } = require('../middleware/auth');
const { adminAuth } = require('../middleware/admin');

// POST /api/reports - Report a listing (validated: the listing must exist and
// the reason must be one of the moderation categories, so no orphan reports
// and no 500s from enum validation).
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, reason, description } = req.body;
    const VALID_REASONS = ['Inappropriate', 'Counterfeit', 'Spam', 'Wrong category', 'Other'];
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ message: 'Invalid report reason' });
    }
    const Listing = require('../models/Listing');
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }
    const report = await Report.create({
      reporter: req.user._id,
      listing: listingId,
      reason,
      description,
    });
    res.status(201).json({ message: 'Report submitted', report });
  } catch (error) {
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: error.message });
    }
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/reports - Moderation queue (admin only: contains reporter PII)
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const reports = await Report.find()
      .populate('reporter', 'name email')
      .populate('listing', 'title')
      .sort({ createdAt: -1 });
    res.json(reports);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// PATCH /api/reports/:id/status - Update report status (admin only)
router.patch('/:id/status', auth, adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    // `findByIdAndUpdate` does NOT run schema validators, so an arbitrary
    // status used to be persisted silently. Validate against the model enum
    // explicitly (and only then ask Mongoose to run validators too).
    const VALID_STATUSES = ['pending', 'resolved', 'dismissed'];
    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({ message: 'Invalid report status' });
    }
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    );
    if (!report) return res.status(404).json({ message: 'Report not found' });
    res.json(report);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
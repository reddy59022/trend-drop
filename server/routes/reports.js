const express = require('express');
const router = express.Router();
const Report = require('../models/Report');
const { auth } = require('../middleware/auth');

// POST /api/reports - Report a listing
router.post('/', auth, async (req, res) => {
  try {
    const { listingId, reason, description } = req.body;
    const report = await Report.create({
      reporter: req.user._id,
      listing: listingId,
      reason,
      description,
    });
    res.status(201).json({ message: 'Report submitted', report });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/reports - Get reports (accessible by anyone for simplicity)
router.get('/', async (req, res) => {
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

// PATCH /api/reports/:id/status - Update report status
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    const report = await Report.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!report) return res.status(404).json({ message: 'Report not found' });
    res.json(report);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
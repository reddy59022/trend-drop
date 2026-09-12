const express = require('express');
const router = express.Router();
const { getPublicFeatures } = require('../config/features');

// GET /api/config/features - Public feature-flag set for client apps.
router.get('/features', (req, res) => {
  try {
    res.json(getPublicFeatures());
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
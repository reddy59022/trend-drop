const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Video = require('../models/Video');
const Listing = require('../models/Listing');

// GET /api/video-shopping - Get all videos for current user
router.get('/', auth, async (req, res) => {
  try {
    const videos = await Video.find({ seller: req.user._id })
      .populate('listing', 'title price images')
      .sort({ createdAt: -1 });
    res.json(videos);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch videos' });
  }
});

// GET /api/video-shopping/public - Get public videos feed
router.get('/public', auth, async (req, res) => {
  try {
    const videos = await Video.find({ isPublic: true, status: 'active' })
      .populate('listing', 'title price images')
      .populate('seller', 'name avatar')
      .sort({ 'analytics.views': -1 })
      .limit(50);
    res.json(videos);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch public videos' });
  }
});

// POST /api/video-shopping/upload - Upload new video
router.post('/upload', auth, async (req, res) => {
  try {
    const { listingId, videoUrl, thumbnailUrl, duration, title, description, effects, tags } = req.body;

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    const video = await Video.create({
      listing: listingId,
      seller: req.user._id,
      videoUrl,
      thumbnailUrl,
      duration,
      title: title || listing.title,
      description,
      effects: effects || [],
      tags: tags || [],
      status: 'processing'
    });

    res.status(201).json(video);
  } catch (error) {
    res.status(500).json({ message: 'Failed to upload video' });
  }
});

// GET /api/video-shopping/:id - Get single video
router.get('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id)
      .populate('listing', 'title price images')
      .populate('seller', 'name avatar');
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    // Increment view count
    video.analytics.views += 1;
    await video.save();

    res.json(video);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch video' });
  }
});

// PUT /api/video-shopping/:id - Update video
router.put('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findOneAndUpdate(
      { _id: req.params.id, seller: req.user._id },
      req.body,
      { new: true }
    );

    if (!video) {
      return res.status(404).json({ message: 'Video not found or not authorized' });
    }

    res.json(video);
  } catch (error) {
    res.status(500).json({ message: 'Failed to update video' });
  }
});

// DELETE /api/video-shopping/:id - Delete video
router.delete('/:id', auth, async (req, res) => {
  try {
    const video = await Video.findOneAndDelete({ _id: req.params.id, seller: req.user._id });
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found or not authorized' });
    }

    res.json({ message: 'Video deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete video' });
  }
});

// POST /api/video-shopping/:id/like - Like a video
router.post('/:id/like', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    video.analytics.likes += 1;
    await video.save();

    res.json({ likes: video.analytics.likes });
  } catch (error) {
    res.status(500).json({ message: 'Failed to like video' });
  }
});

// POST /api/video-shopping/:id/share - Share a video
router.post('/:id/share', auth, async (req, res) => {
  try {
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    video.analytics.shares += 1;
    await video.save();

    res.json({ shares: video.analytics.shares });
  } catch (error) {
    res.status(500).json({ message: 'Failed to share video' });
  }
});

// GET /api/video-shopping/analytics/:id - Get video analytics
router.get('/analytics/:id', auth, async (req, res) => {
  try {
    const video = await Video.findOne({ _id: req.params.id, seller: req.user._id });
    
    if (!video) {
      return res.status(404).json({ message: 'Video not found' });
    }

    res.json(video.analytics);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch analytics' });
  }
});

module.exports = router;
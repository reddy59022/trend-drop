const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const Comment = require('../models/Comment');

// GET /api/comments/trending - Get trending hashtags (must be before /:listingId)
router.get('/trending', async (req, res) => {
  try {
    // Get all comments
    const comments = await Comment.find({});
    
    // Count hashtag occurrences
    const hashtagCount = {};
    comments.forEach(comment => {
      const tags = comment.hashtags || [];
      tags.forEach(tag => {
        hashtagCount[tag] = (hashtagCount[tag] || 0) + 1;
      });
    });
    
    // Sort by count and return top 20
    const trending = Object.entries(hashtagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
    
    res.json(trending);
  } catch (error) {
    console.error('Trending error:', error);
    res.status(500).json({ message: 'Failed to fetch trending hashtags' });
  }
});

// GET /api/comments/hashtag/:tag - Get comments by hashtag (must be before /:listingId)
router.get('/hashtag/:tag', async (req, res) => {
  try {
    const { tag } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const comments = await Comment.find({ hashtags: tag.toLowerCase() })
      .populate('userId', 'name avatar')
      .populate('listingId', 'title images price')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    res.json({ comments });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch hashtag comments' });
  }
});

// GET /api/comments/:listingId - Get all comments for a listing
router.get('/:listingId', async (req, res) => {
  try {
    const { listingId } = req.params;
    const { page = 1, limit = 50 } = req.query;
    
    const comments = await Comment.find({ listingId, parentId: null })
      .populate('userId', 'name avatar')
      .populate({ path: 'replies', populate: { path: 'userId', select: 'name avatar' } })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    
    const total = await Comment.countDocuments({ listingId, parentId: null });
    
    res.json({
      comments,
      pagination: { currentPage: page, totalPages: Math.ceil(total / limit), total },
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch comments' });
  }
});

// POST /api/comments/:listingId - Add a comment to a listing
router.post('/:listingId', auth, async (req, res) => {
  try {
    const { listingId } = req.params;
    const { text, parentId } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ message: 'Comment text is required' });
    }
    
    // If it's a reply, validate parentId
    if (parentId) {
      const parent = await Comment.findById(parentId);
      if (!parent) {
        return res.status(404).json({ message: 'Parent comment not found' });
      }
    }
    
    const comment = await Comment.create({
      listingId,
      userId: req.user._id,
      text,
      parentId: parentId || null,
    });
    
    // If it's a reply, add to parent's replies array
    if (parentId) {
      await Comment.findByIdAndUpdate(parentId, {
        $push: { replies: comment._id },
      });
    }
    
    const populated = await Comment.findById(comment._id)
      .populate('userId', 'name avatar');
    
    res.json(populated);
  } catch (error) {
    res.status(500).json({ message: 'Failed to create comment' });
  }
});

// PUT /api/comments/:id/like - Like/unlike a comment
router.put('/:id/like', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    
    const likeIndex = comment.likes.indexOf(req.user._id);
    if (likeIndex > -1) {
      comment.likes.splice(likeIndex, 1);
    } else {
      comment.likes.push(req.user._id);
    }
    await comment.save();
    
    res.json({ likes: comment.likes.length, liked: likeIndex === -1 });
  } catch (error) {
    res.status(500).json({ message: 'Failed to update like status' });
  }
});

// DELETE /api/comments/:id - Delete a comment
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    
    const comment = await Comment.findById(id);
    if (!comment) {
      return res.status(404).json({ message: 'Comment not found' });
    }
    
    if (comment.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to delete this comment' });
    }
    
    // If it's a reply, remove from parent's replies
    if (comment.parentId) {
      await Comment.findByIdAndUpdate(comment.parentId, {
        $pull: { replies: comment._id },
      });
    }
    
    await Comment.findByIdAndDelete(id);
    
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    res.status(500).json({ message: 'Failed to delete comment' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const User = require('../models/User');
const { asNumber } = require('../utils/validators');

// ===================== NOTIFICATIONS =====================
// GET /api/notifications - Get current user's notifications with optional unread count
router.get('/', auth, async (req, res) => {
  try {
    const { unread } = req.query;
    // Validate pagination input: a non-numeric or zero ?page must fall back to
    // page 1 (not an empty slice + NaN currentPage), and ?limit is clamped.
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.max(1, Math.min(asNumber(req.query.limit, 50) || 50, 100));
    const user = await User.findById(req.user._id)
      .populate('notifications.from', 'name avatar')
      .populate('notifications.listing', 'title images price');

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    let notifications = [...user.notifications].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Support the Navbar's unread count query: /api/notifications?limit=1&unread=true
    const unreadCount = notifications.filter(n => !n.read).length;

    if (unread === 'true' || unread === '1') {
      notifications = notifications.filter(n => !n.read);
    }

    const total = notifications.length;
    const start = (page - 1) * pageSize;
    const paged = notifications.slice(start, start + pageSize);

    res.setHeader('X-Total-Count', unreadCount);
    res.setHeader('X-Unread-Count', unreadCount);
    res.json({
      notifications: paged,
      unreadCount,
      total,
      totalPages: Math.ceil(total / pageSize),
      currentPage: page,
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ message: 'Failed to fetch notifications' });
  }
});

// GET /api/notifications/unread-count - Get unread notification count
router.get('/unread-count', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const unreadCount = user.notifications.filter(n => !n.read).length;
    res.json({ unreadCount });
  } catch (error) {
    console.error('Get unread count error:', error);
    res.status(500).json({ message: 'Failed to fetch unread count' });
  }
});

// PUT /api/notifications/read - Mark all notifications as read
router.put('/read', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.notifications.forEach(n => { n.read = true; });
    await user.save();
    res.json({ message: 'Notifications marked as read', unreadCount: 0 });
  } catch (error) {
    console.error('Mark notifications read error:', error);
    res.status(500).json({ message: 'Failed to mark notifications as read' });
  }
});

// PUT /api/notifications/:id/read - Mark a single notification as read
router.put('/:id/read', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    const notif = user.notifications.id(req.params.id);
    if (!notif) {
      return res.status(404).json({ message: 'Notification not found' });
    }
    notif.read = true;
    await user.save();
    const unreadCount = user.notifications.filter(n => !n.read).length;
    res.json({ message: 'Notification marked as read', unreadCount });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ message: 'Failed to mark notification as read' });
  }
});

// DELETE /api/notifications/:id - Delete a single notification
router.delete('/:id', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    user.notifications.pull({ _id: req.params.id });
    await user.save();
    res.json({ message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ message: 'Failed to delete notification' });
  }
});

module.exports = router;
// Admin authentication middleware
// Checks if the authenticated user has admin privileges
// Requires the auth middleware to run first (req.user must be set)

const User = require('../models/User');

const adminAuth = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(401).json({ message: 'User not found' });
    }

    // Check if user has admin role
    if (user.role !== 'admin') {
      // For MVP, hard-coded admin emails also have access
      const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase());
      if (!adminEmails.includes(user.email.toLowerCase())) {
        return res.status(403).json({ message: 'Admin access required' });
      }
    }

    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { adminAuth };
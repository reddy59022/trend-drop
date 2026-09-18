const User = require('../models/User');

const legalCounselAuth = async (req, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ message: 'Authentication required' });
    const user = await User.findById(req.user._id).select('role email');
    if (!user) return res.status(401).json({ message: 'User not found' });
    const configured = (process.env.LEGAL_COUNSEL_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
    const allowed = user.role === 'admin' || user.role === 'legal_counsel' || configured.includes(user.email.toLowerCase());
    if (!allowed) return res.status(403).json({ message: 'Legal counsel access required' });
    req.legalActor = user;
    next();
  } catch (error) {
    console.error('Legal counsel auth error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { legalCounselAuth };

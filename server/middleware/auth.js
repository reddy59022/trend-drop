const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getJwtSecret } = require('../config/security');
const { isSuspendedRole } = require('../criticalRules');

const auth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ message: 'No token, authorization denied' });
    }

    const decoded = jwt.verify(token, getJwtSecret());
    const user = await User.findById(decoded.id).select('-password');
    if (!user || user.deletedAt) {
      return res.status(401).json({ message: 'Token is not valid' });
    }

    // Tokens signed before a password reset carry an older generation and are
    // rejected even though they have not expired. Tokens without `tv` predate
    // this field and are treated as generation 0 for backward compatibility.
    if ((decoded.tv || 0) !== (user.tokenVersion || 0)) {
      return res.status(401).json({ message: 'Session expired. Please log in again.' });
    }

    req.user = user;

    // Suspended accounts are locked out immediately: a valid token must not
    // grant any further API access once an admin suspends the account.
    if (isSuspendedRole(user.role)) {
      return res.status(403).json({ message: 'Account suspended. Contact support.' });
    }

    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token is not valid' });
  }
};

const optionalAuth = async (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    if (token) {
      const decoded = jwt.verify(token, getJwtSecret());
      const user = await User.findById(decoded.id).select('-password');
      // optionalAuth must enforce the same account-state rules as auth for
      // the routes that use it to expose private resources (collections,
      // parties, drafts). A suspended user is treated as anonymous instead of
      // retaining access merely because the route is "optional" auth.
      if (user && !user.deletedAt && (decoded.tv || 0) === (user.tokenVersion || 0)
        && !isSuspendedRole(user.role)) {
        req.user = user;
      }
    }
  } catch (error) {
    // Continue without auth
  }
  next();
};

module.exports = { auth, optionalAuth };
const { requireAuth } = require('@clerk/express');

// Middleware to restrict routes to specific roles
const checkRole = (allowedRoles) => {
  return (req, res, next) => {
    // req.auth is populated by clerkMiddleware()
    const userRole = req.auth?.sessionClaims?.metadata?.role || 'citizen';

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }
    next();
  };
};

module.exports = { checkRole };
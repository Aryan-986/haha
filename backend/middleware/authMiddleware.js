const { clerkClient } = require('@clerk/express');

// In-memory cache for user metadata to minimize Clerk API roundtrips
const userCache = new Map();

/**
 * Authoritatively resolves user role from JWT claims or Clerk SDK
 */
async function resolveUserRole(req) {
  // Test environment bypass
  if (process.env.NODE_ENV === 'test' && req.headers['x-test-role']) {
    return req.headers['x-test-role'];
  }

  // Check token claims first
  const claimRole = (
    req.auth?.sessionClaims?.metadata?.role ||
    req.auth?.sessionClaims?.publicMetadata?.role ||
    req.auth?.sessionClaims?.role ||
    req.auth?.claims?.metadata?.role ||
    req.auth?.claims?.publicMetadata?.role ||
    req.auth?.claims?.role
  );
  if (claimRole) return claimRole;

  // Resolve via Clerk API if userId is present
  const userId = req.auth?.userId;
  if (!userId || !process.env.CLERK_SECRET_KEY) return 'citizen';

  const cached = userCache.get(userId);
  if (cached && (Date.now() - cached.timestamp < 60000)) {
    return cached.role;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const role = user?.publicMetadata?.role || 'citizen';
    userCache.set(userId, { role, timestamp: Date.now(), metadata: user?.publicMetadata || {} });
    return role;
  } catch (err) {
    console.warn(`[Clerk Auth] Failed to resolve role for user ${userId}:`, err.message);
    return 'citizen';
  }
}

/**
 * Middleware to restrict routes to specific roles
 */
const checkRole = (allowedRoles) => {
  return async (req, res, next) => {
    // If Clerk is active and user is not authenticated
    if (!req.auth?.userId && process.env.NODE_ENV !== 'test') {
      return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
    }

    const userRole = await resolveUserRole(req);
    req.userRole = userRole;

    const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());
    if (!normalizedAllowed.includes((userRole || '').toLowerCase())) {
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions. Only authorized accounts can perform this action.' });
    }
    next();
  };
};

module.exports = { checkRole, resolveUserRole, userCache };
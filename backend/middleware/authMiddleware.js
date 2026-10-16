/**
 * authMiddleware.js
 * Secure authentication and authorization for QueueLess backend.
 *
 * Security guarantees:
 * - Staff identity is ALWAYS resolved server-side from the Clerk user record
 * - Roles are read from Clerk publicMetadata via the Admin SDK (not client-supplied)
 * - Test bypass is DISABLED in production and requires a separate env flag
 * - No identity fallbacks based on query parameters or request bodies
 */

const { clerkClient } = require('@clerk/express');
const Worker = require('../models/Worker');

// In-memory cache for user metadata (avoids redundant Clerk SDK calls)
// Entries expire after 60 seconds so role changes propagate quickly
const userCache = new Map();
const CACHE_TTL_MS = 60_000;

/**
 * Resolves the authenticated Clerk userId from the request.
 * Returns null if no valid session is present.
 */
function getAuthenticatedUserId(req) {
  return req.auth?.userId || null;
}

/**
 * Resolves user role authoritatively from Clerk's server-side record.
 * Never trusts client-supplied roles or headers.
 *
 * In test environments only (when TEST_AUTH_BYPASS=true AND NODE_ENV=test),
 * accepts the x-test-role header for integration test convenience.
 * This bypass is disabled in production regardless of NODE_ENV.
 */
async function resolveUserRole(req) {
  // Test bypass: only when BOTH flags are set, never in production
  const isTestBypassEnabled =
    process.env.NODE_ENV === 'test' &&
    process.env.TEST_AUTH_BYPASS === 'true' &&
    process.env.NODE_ENV !== 'production';

  if (isTestBypassEnabled && req.headers['x-test-role']) {
    return req.headers['x-test-role'].toLowerCase();
  }

  const userId = getAuthenticatedUserId(req);
  if (!userId) return null;

  // Cache hit
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.role;
  }

  const masterAdminEmail = (process.env.MASTER_ADMIN_EMAIL || 'aryankarki984@gmail.com').toLowerCase();

  // Resolve from Clerk Admin SDK (authoritative)
  if (!process.env.CLERK_SECRET_KEY) {
    // Clerk not configured — fall back to JWT claims only (dev convenience)
    const claimRole = (
      req.auth?.sessionClaims?.publicMetadata?.role ||
      req.auth?.sessionClaims?.metadata?.role ||
      req.auth?.sessionClaims?.role
    );
    return (claimRole || 'citizen').toLowerCase();
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    let role = (user?.publicMetadata?.role || 'citizen').toLowerCase();

    // Authoritative bootstrap check by email
    const hasAdminEmail = user?.emailAddresses?.some(
      e => e.emailAddress?.toLowerCase() === masterAdminEmail
    );

    if (hasAdminEmail) {
      role = 'master_admin';
      if (user?.publicMetadata?.role !== 'master_admin') {
        try {
          await clerkClient.users.updateUserMetadata(userId, {
            publicMetadata: { role: 'master_admin' }
          });
        } catch (mErr) {
          console.warn('[Auth] Failed to sync master_admin metadata:', mErr.message);
        }
      }
    }

    userCache.set(userId, { role, timestamp: Date.now() });
    return role;
  } catch (err) {
    console.warn(`[Auth] Failed to resolve role for user ${userId}:`, err.message);
    return 'citizen';
  }
}

/**
 * Resolves the authenticated staff worker record from the database.
 * The worker must be linked to the Clerk userId via Worker.authUserId.
 *
 * Returns null if no worker record found.
 * Attaches result to req.staffWorker for downstream use.
 */
async function resolveStaffWorker(req) {
  const userId = getAuthenticatedUserId(req);
  if (!userId) return null;

  try {
    const worker = await Worker.findOne({ authUserId: userId })
      .populate('organizationId', 'name type status isDeleted')
      .populate('departmentId', 'name prefix roomNumber orgId')
      .populate('counterId', 'name counterNumber status isActive currentTicketId');

    if (!worker) return null;
    req.staffWorker = worker;
    return worker;
  } catch (err) {
    console.warn('[Auth] Failed to resolve staff worker:', err.message);
    return null;
  }
}

/**
 * Middleware: Requires an authenticated Clerk session.
 * Returns 401 if no valid session token is present.
 * Supports test bypass with TEST_AUTH_BYPASS=true and NODE_ENV=test.
 */
const requireAuth = (req, res, next) => {
  const isTestBypassEnabled =
    process.env.NODE_ENV === 'test' &&
    process.env.TEST_AUTH_BYPASS === 'true';

  if (isTestBypassEnabled && req.headers['x-test-user-id']) {
    // Inject a synthetic auth object for tests
    req.auth = req.auth || {};
    req.auth.userId = req.headers['x-test-user-id'];
    return next();
  }

  if (!req.auth?.userId) {
    return res.status(401).json({
      error: 'Unauthorized: Authentication required. Please sign in.'
    });
  }

  next();
};

/**
 * Middleware factory: Restricts routes to specific roles.
 * Usage: router.use(checkRole(['worker', 'supervisor']))
 *
 * @param {string[]} allowedRoles - lowercase role strings
 */
const checkRole = (allowedRoles) => {
  return async (req, res, next) => {
    const isTestBypassEnabled =
      process.env.NODE_ENV === 'test' &&
      process.env.TEST_AUTH_BYPASS === 'true';

    // Reject unauthenticated requests (unless test bypass)
    if (!req.auth?.userId && !isTestBypassEnabled) {
      return res.status(401).json({
        error: 'Unauthorized: Authentication required.'
      });
    }

    const userRole = await resolveUserRole(req);
    req.userRole = userRole;

    const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());
    if (!normalizedAllowed.includes((userRole || '').toLowerCase())) {
      return res.status(403).json({
        error: `Forbidden: Insufficient permissions. Required: ${normalizedAllowed.join(' or ')}.`
      });
    }

    next();
  };
};

/**
 * Middleware: Requires an authenticated worker whose organizationId matches
 * the orgId in the request params/body/query.
 * Attaches req.staffWorker for downstream use.
 *
 * Returns 401 if not authenticated, 403 if worker not found or scope mismatch.
 */
const requireWorkerScope = async (req, res, next) => {
  const isTestBypassEnabled =
    process.env.NODE_ENV === 'test' &&
    process.env.TEST_AUTH_BYPASS === 'true';

  if (!req.auth?.userId && !isTestBypassEnabled) {
    return res.status(401).json({
      error: 'Unauthorized: Authentication required.'
    });
  }

  // In test mode, skip worker scope validation if test role header is present
  if (isTestBypassEnabled && req.headers['x-test-role']) {
    req.userRole = req.headers['x-test-role'].toLowerCase();
    return next();
  }

  const worker = await resolveStaffWorker(req);
  if (!worker) {
    return res.status(403).json({
      error: 'Forbidden: No staff profile found for this account.'
    });
  }

  // Verify the worker's organization/department matches what's being accessed
  const reqOrgId = (
    req.params.orgId ||
    req.body?.organizationId ||
    req.query?.organizationId ||
    req.body?.orgId ||
    req.query?.orgId
  );

  if (reqOrgId && worker.organizationId?._id?.toString() !== reqOrgId.toString()) {
    return res.status(403).json({
      error: 'Forbidden: You are not authorized to access this organization.'
    });
  }

  req.userRole = worker.role?.toLowerCase();
  next();
};

/**
 * Middleware: Requires supervisor or master_admin role with org scope.
 */
const requireSupervisorScope = async (req, res, next) => {
  const isTestBypassEnabled =
    process.env.NODE_ENV === 'test' &&
    process.env.TEST_AUTH_BYPASS === 'true';

  if (!req.auth?.userId && !isTestBypassEnabled) {
    return res.status(401).json({ error: 'Unauthorized: Authentication required.' });
  }

  const userRole = await resolveUserRole(req);
  req.userRole = userRole;

  if (!['supervisor', 'master_admin', 'org_admin'].includes((userRole || '').toLowerCase())) {
    return res.status(403).json({
      error: 'Forbidden: Supervisor or higher role required.'
    });
  }

  // Resolve worker record for scope checking
  if (!isTestBypassEnabled) {
    const worker = await resolveStaffWorker(req);
    if (!worker && userRole !== 'master_admin') {
      return res.status(403).json({
        error: 'Forbidden: No staff profile found for this account.'
      });
    }
  }

  next();
};

/**
 * Invalidate the role cache for a specific user (call after role changes).
 */
function invalidateUserCache(userId) {
  userCache.delete(userId);
}

module.exports = {
  requireAuth,
  checkRole,
  requireWorkerScope,
  requireSupervisorScope,
  resolveUserRole,
  resolveStaffWorker,
  getAuthenticatedUserId,
  invalidateUserCache,
  userCache
};
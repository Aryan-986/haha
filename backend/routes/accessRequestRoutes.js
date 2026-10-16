/**
 * accessRequestRoutes.js
 * Staff access request and approval workflow.
 *
 * Public (authenticated) endpoints:
 *   POST   /api/v1/access-requests          — Submit a new access request
 *   GET    /api/v1/access-requests/my        — Get my requests
 *   DELETE /api/v1/access-requests/:id       — Cancel my pending request
 *
 * Admin-only endpoints:
 *   GET    /api/v1/access-requests           — List all requests (with filters)
 *   GET    /api/v1/access-requests/:id       — Get request details
 *   POST   /api/v1/access-requests/:id/approve  — Approve a request
 *   POST   /api/v1/access-requests/:id/reject   — Reject a request
 *
 * Staff directory (admin-only):
 *   GET    /api/v1/staff                     — List all approved staff
 *   GET    /api/v1/staff/:id                 — Staff member details
 *   PATCH  /api/v1/staff/:id                 — Update staff assignment
 *   POST   /api/v1/staff/:id/deactivate      — Deactivate staff
 *   POST   /api/v1/staff/:id/reactivate      — Reactivate staff
 *   POST   /api/v1/staff/:id/revoke          — Revoke org membership
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { clerkClient } = require('@clerk/express');
const AccessRequest = require('../models/AccessRequest');
const AuditLog = require('../models/AuditLog');
const Worker = require('../models/Worker');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Counter = require('../models/Counter');
const { requireAuth, checkRole, resolveUserRole, invalidateUserCache } = require('../middleware/authMiddleware');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ═══════════════════════════════════════════════════════════════════
// MASTER ADMIN EMAIL — Bootstrap identity
// ═══════════════════════════════════════════════════════════════════
const MASTER_ADMIN_EMAIL = process.env.MASTER_ADMIN_EMAIL || 'aryankarki984@gmail.com';

// ═══════════════════════════════════════════════════════════════════
// HELPER: Resolve Clerk user info for display
// ═══════════════════════════════════════════════════════════════════
async function getClerkUserInfo(clerkUserId) {
  if (!process.env.CLERK_SECRET_KEY || !clerkUserId) return null;
  try {
    const user = await clerkClient.users.getUser(clerkUserId);
    return {
      id: user.id,
      email: user.emailAddresses?.[0]?.emailAddress || '',
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || '',
      imageUrl: user.imageUrl || null
    };
  } catch (err) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// HELPER: Check if the current user is the master admin
// ═══════════════════════════════════════════════════════════════════
async function isMasterAdmin(req) {
  const userId = req.auth?.userId;
  if (!userId) return false;

  // Check via Clerk metadata first
  const role = await resolveUserRole(req);
  if (role === 'master_admin') return true;

  // Bootstrap check: if the user's email matches the master admin email
  if (process.env.CLERK_SECRET_KEY) {
    try {
      const user = await clerkClient.users.getUser(userId);
      const email = user.emailAddresses?.[0]?.emailAddress?.toLowerCase();
      if (email === MASTER_ADMIN_EMAIL.toLowerCase()) {
        // Auto-bootstrap: set this user as master_admin in Clerk metadata
        await clerkClient.users.updateUserMetadata(userId, {
          publicMetadata: {
            role: 'master_admin'
          }
        });
        invalidateUserCache(userId);

        // Record bootstrap in audit log
        await AuditLog.create({
          actorId: userId,
          actorEmail: email,
          action: 'MASTER_ADMIN_BOOTSTRAPPED',
          targetType: 'USER',
          targetId: userId,
          details: { email, method: 'auto_bootstrap' }
        });

        return true;
      }
    } catch (err) {
      console.warn('[Auth] Master admin bootstrap check failed:', err.message);
    }
  }

  return false;
}

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/access-requests/my — Get my access requests
// Any authenticated user can see their own requests
// ═══════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, async (req, res) => {
  try {
    const clerkUserId = req.auth.userId;
    const requests = await AccessRequest.find({ clerkUserId })
      .populate('organizationId', 'name type address status')
      .sort({ createdAt: -1 });

    res.json({ success: true, requests });
  } catch (err) {
    console.error('Error fetching my access requests:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch your access requests.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// GET /api/v1/access-requests/my/status — Quick status check
// Returns the user's current access status for portal routing
// ═══════════════════════════════════════════════════════════════════
router.get('/my/status', requireAuth, async (req, res) => {
  try {
    const clerkUserId = req.auth.userId;

    // Check if user is master admin
    const isAdmin = await isMasterAdmin(req);
    if (isAdmin) {
      return res.json({
        success: true,
        isMasterAdmin: true,
        role: 'master_admin',
        hasApprovedAccess: true,
        pendingRequests: [],
        approvedMemberships: []
      });
    }

    // Check for approved Worker records
    const approvedWorkers = await Worker.find({ authUserId: clerkUserId, status: { $ne: 'DEACTIVATED' } })
      .populate('organizationId', 'name type status')
      .populate('departmentId', 'name prefix')
      .populate('counterId', 'name counterNumber');

    // Check for pending requests
    const pendingRequests = await AccessRequest.find({ clerkUserId, status: 'PENDING' })
      .populate('organizationId', 'name type');

    const hasApprovedAccess = approvedWorkers.length > 0;
    const role = hasApprovedAccess ? approvedWorkers[0].role?.toLowerCase() : null;

    res.json({
      success: true,
      isMasterAdmin: false,
      role,
      hasApprovedAccess,
      pendingRequests: pendingRequests.map(r => ({
        _id: r._id,
        organizationName: r.organizationId?.name,
        requestedRole: r.requestedRole,
        status: r.status,
        createdAt: r.createdAt
      })),
      approvedMemberships: approvedWorkers.map(w => ({
        _id: w._id,
        organizationId: w.organizationId?._id,
        organizationName: w.organizationId?.name,
        role: w.role,
        departmentName: w.departmentId?.name,
        counterName: w.counterId?.name,
        status: w.status
      }))
    });
  } catch (err) {
    console.error('Error fetching access status:', err);
    res.status(500).json({ success: false, error: 'Failed to check access status.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST /api/v1/access-requests — Submit a new access request
// ═══════════════════════════════════════════════════════════════════
router.post('/', requireAuth, async (req, res) => {
  try {
    const clerkUserId = req.auth.userId;
    const { organizationId, requestedRole, message, applicantName, applicantEmail } = req.body;

    // Validate required fields
    if (!organizationId || !isValidObjectId(organizationId)) {
      return res.status(400).json({ success: false, error: 'Valid organizationId is required.' });
    }
    if (!requestedRole || !['WORKER', 'SUPERVISOR'].includes(requestedRole)) {
      return res.status(400).json({ success: false, error: 'requestedRole must be WORKER or SUPERVISOR.' });
    }

    // Prevent master_admin from submitting requests (they already have access)
    const isAdmin = await isMasterAdmin(req);
    if (isAdmin) {
      return res.status(400).json({ success: false, error: 'Master administrators already have full access.' });
    }

    // Verify organization exists and is active
    const org = await Organization.findOne({ _id: organizationId, isDeleted: { $ne: true }, status: 'ACTIVE' });
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found or is inactive.' });
    }

    // Check for existing approved membership
    const existingWorker = await Worker.findOne({ authUserId: clerkUserId, organizationId, status: { $ne: 'DEACTIVATED' } });
    if (existingWorker) {
      return res.status(400).json({
        success: false,
        error: `You already have an active ${existingWorker.role} membership in this organization.`
      });
    }

    // Resolve applicant info from Clerk if not provided
    let name = applicantName;
    let email = applicantEmail;
    if (!name || !email) {
      const clerkInfo = await getClerkUserInfo(clerkUserId);
      if (clerkInfo) {
        name = name || clerkInfo.name || 'Unknown';
        email = email || clerkInfo.email || '';
      }
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Applicant name is required.' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ success: false, error: 'Applicant email is required.' });
    }

    // Create the access request (unique partial index prevents duplicate PENDING requests)
    const accessRequest = await AccessRequest.create({
      clerkUserId,
      applicantName: name.trim(),
      applicantEmail: email.trim().toLowerCase(),
      organizationId,
      requestedRole,
      message: (message || '').trim().slice(0, 500),
      status: 'PENDING'
    });

    // Audit log
    await AuditLog.create({
      actorId: clerkUserId,
      actorEmail: email,
      action: 'ACCESS_REQUEST_SUBMITTED',
      targetType: 'ACCESS_REQUEST',
      targetId: accessRequest._id.toString(),
      organizationId,
      details: { requestedRole, organizationName: org.name }
    });

    res.status(201).json({
      success: true,
      message: 'Access request submitted successfully. A Master Admin will review your request.',
      accessRequest
    });
  } catch (err) {
    // Handle duplicate key error from partial unique index
    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        error: 'You already have a pending request for this organization and role.'
      });
    }
    console.error('Error submitting access request:', err);
    res.status(500).json({ success: false, error: 'Failed to submit access request.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// DELETE /api/v1/access-requests/:id — Cancel my own pending request
// ═══════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const clerkUserId = req.auth.userId;
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID.' });
    }

    const request = await AccessRequest.findOne({ _id: id, clerkUserId, status: 'PENDING' });
    if (!request) {
      return res.status(404).json({ success: false, error: 'Pending request not found.' });
    }

    request.status = 'CANCELLED';
    request.processedAt = new Date();
    request.processedBy = clerkUserId;
    await request.save();

    await AuditLog.create({
      actorId: clerkUserId,
      action: 'ACCESS_REQUEST_CANCELLED',
      targetType: 'ACCESS_REQUEST',
      targetId: id,
      organizationId: request.organizationId
    });

    res.json({ success: true, message: 'Access request cancelled.' });
  } catch (err) {
    console.error('Error cancelling access request:', err);
    res.status(500).json({ success: false, error: 'Failed to cancel request.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS — All require master_admin role
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/access-requests — List all access requests (admin only)
 * Supports filters: status, organizationId, requestedRole, search
 */
router.get('/', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const { status, organizationId, requestedRole, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status) filter.status = status.toUpperCase();
    if (organizationId && isValidObjectId(organizationId)) filter.organizationId = organizationId;
    if (requestedRole) filter.requestedRole = requestedRole.toUpperCase();

    // Text search across name and email
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { applicantName: searchRegex },
        { applicantEmail: searchRegex },
        { clerkUserId: searchRegex }
      ];
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const [requests, total] = await Promise.all([
      AccessRequest.find(filter)
        .populate('organizationId', 'name type status')
        .populate('resultingWorkerId', 'name role status departmentId counterId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AccessRequest.countDocuments(filter)
    ]);

    res.json({ success: true, requests, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Error listing access requests:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch access requests.' });
  }
});

/**
 * GET /api/v1/access-requests/:id — Get request details (admin only)
 */
router.get('/:id', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID.' });
    }

    const request = await AccessRequest.findById(id)
      .populate('organizationId', 'name type address status')
      .populate('approvalDetails.approvedOrganizationId', 'name type')
      .populate('approvalDetails.approvedDepartmentId', 'name prefix')
      .populate('approvalDetails.approvedCounterId', 'name counterNumber')
      .populate('resultingWorkerId');

    if (!request) {
      return res.status(404).json({ success: false, error: 'Access request not found.' });
    }

    res.json({ success: true, request });
  } catch (err) {
    console.error('Error fetching access request:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch request details.' });
  }
});

/**
 * POST /api/v1/access-requests/:id/approve — Approve a request (admin only)
 * Body: { role, organizationId, departmentId?, counterId? }
 */
router.post('/:id/approve', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const adminUserId = req.auth.userId;
    const { id } = req.params;
    const { role, organizationId, departmentId, counterId } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID.' });
    }

    const request = await AccessRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, error: 'Access request not found.' });
    }
    if (request.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: `Cannot approve a request with status: ${request.status}` });
    }

    // Validate the role the admin is assigning
    const assignedRole = (role || request.requestedRole).toUpperCase();
    if (!['WORKER', 'SUPERVISOR'].includes(assignedRole)) {
      return res.status(400).json({ success: false, error: 'Assigned role must be WORKER or SUPERVISOR.' });
    }

    // Validate organization
    const orgId = organizationId || request.organizationId;
    if (!isValidObjectId(orgId)) {
      return res.status(400).json({ success: false, error: 'Valid organizationId is required for approval.' });
    }
    const org = await Organization.findOne({ _id: orgId, isDeleted: { $ne: true } });
    if (!org) {
      return res.status(404).json({ success: false, error: 'Organization not found or archived.' });
    }

    // Validate department if provided
    let dept = null;
    if (departmentId) {
      if (!isValidObjectId(departmentId)) {
        return res.status(400).json({ success: false, error: 'Invalid departmentId format.' });
      }
      dept = await Department.findOne({ _id: departmentId, orgId });
      if (!dept) {
        return res.status(400).json({ success: false, error: 'Department not found in specified organization.' });
      }
    }

    // Validate counter if provided
    let counter = null;
    if (counterId) {
      if (!isValidObjectId(counterId)) {
        return res.status(400).json({ success: false, error: 'Invalid counterId format.' });
      }
      counter = await Counter.findOne({ _id: counterId, organizationId: orgId });
      if (!counter) {
        return res.status(400).json({ success: false, error: 'Counter not found in specified organization.' });
      }
    }

    // Check for existing active worker record to prevent duplicates
    const existingWorker = await Worker.findOne({
      authUserId: request.clerkUserId,
      organizationId: orgId,
      status: { $ne: 'DEACTIVATED' }
    });
    if (existingWorker) {
      return res.status(409).json({
        success: false,
        error: 'User already has an active staff membership in this organization.'
      });
    }

    // Create the Worker record (authoritative staff membership)
    const worker = await Worker.create({
      authUserId: request.clerkUserId,
      organizationId: orgId,
      departmentId: dept ? dept._id : null,
      counterId: counter ? counter._id : null,
      name: request.applicantName,
      role: assignedRole,
      status: 'AVAILABLE'
    });

    // Update Clerk metadata to reflect the assigned role
    if (process.env.CLERK_SECRET_KEY) {
      try {
        await clerkClient.users.updateUserMetadata(request.clerkUserId, {
          publicMetadata: {
            role: assignedRole.toLowerCase(),
            organizationId: orgId.toString(),
            departmentId: dept ? dept._id.toString() : null,
            counterId: counter ? counter._id.toString() : null
          }
        });
        invalidateUserCache(request.clerkUserId);
      } catch (clerkErr) {
        console.warn('[Approval] Clerk metadata update failed:', clerkErr.message);
      }
    }

    // Update the access request record
    request.status = 'APPROVED';
    request.processedBy = adminUserId;
    request.processedAt = new Date();
    request.resultingWorkerId = worker._id;
    request.approvalDetails = {
      approvedRole: assignedRole,
      approvedOrganizationId: orgId,
      approvedDepartmentId: dept ? dept._id : null,
      approvedCounterId: counter ? counter._id : null,
      approvedBy: adminUserId,
      approvedAt: new Date()
    };
    await request.save();

    // Audit log
    await AuditLog.create({
      actorId: adminUserId,
      action: 'ACCESS_REQUEST_APPROVED',
      targetType: 'ACCESS_REQUEST',
      targetId: id,
      organizationId: orgId,
      details: {
        applicantName: request.applicantName,
        applicantEmail: request.applicantEmail,
        assignedRole,
        organizationName: org.name,
        departmentName: dept?.name || null,
        counterName: counter?.name || null,
        workerId: worker._id.toString()
      }
    });

    await AuditLog.create({
      actorId: adminUserId,
      action: 'STAFF_CREATED',
      targetType: 'WORKER',
      targetId: worker._id.toString(),
      organizationId: orgId,
      details: {
        name: request.applicantName,
        role: assignedRole,
        clerkUserId: request.clerkUserId
      }
    });

    res.json({
      success: true,
      message: `Request approved. ${request.applicantName} has been assigned as ${assignedRole} in ${org.name}.`,
      worker,
      accessRequest: request
    });
  } catch (err) {
    console.error('Error approving access request:', err);
    res.status(500).json({ success: false, error: 'Failed to approve request.' });
  }
});

/**
 * POST /api/v1/access-requests/:id/reject — Reject a request (admin only)
 * Body: { reason? }
 */
router.post('/:id/reject', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const adminUserId = req.auth.userId;
    const { id } = req.params;
    const { reason } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid request ID.' });
    }

    const request = await AccessRequest.findById(id);
    if (!request) {
      return res.status(404).json({ success: false, error: 'Access request not found.' });
    }
    if (request.status !== 'PENDING') {
      return res.status(400).json({ success: false, error: `Cannot reject a request with status: ${request.status}` });
    }

    request.status = 'REJECTED';
    request.rejectionReason = (reason || '').trim();
    request.processedBy = adminUserId;
    request.processedAt = new Date();
    await request.save();

    await AuditLog.create({
      actorId: adminUserId,
      action: 'ACCESS_REQUEST_REJECTED',
      targetType: 'ACCESS_REQUEST',
      targetId: id,
      organizationId: request.organizationId,
      details: {
        applicantName: request.applicantName,
        reason: request.rejectionReason
      }
    });

    res.json({ success: true, message: 'Access request rejected.', accessRequest: request });
  } catch (err) {
    console.error('Error rejecting access request:', err);
    res.status(500).json({ success: false, error: 'Failed to reject request.' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// STAFF DIRECTORY — Admin only
// ═══════════════════════════════════════════════════════════════════

/**
 * GET /api/v1/staff — List all staff members
 */
router.get('/staff/list', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const { organizationId, role, status, departmentId, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (organizationId && isValidObjectId(organizationId)) filter.organizationId = organizationId;
    if (role) filter.role = role.toUpperCase();
    if (status) filter.status = status.toUpperCase();
    if (departmentId && isValidObjectId(departmentId)) filter.departmentId = departmentId;

    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { name: searchRegex },
        { authUserId: searchRegex }
      ];
    }

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const [workers, total] = await Promise.all([
      Worker.find(filter)
        .populate('organizationId', 'name type status')
        .populate('departmentId', 'name prefix roomNumber')
        .populate('counterId', 'name counterNumber status')
        .sort({ name: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Worker.countDocuments(filter)
    ]);

    // Enrich with Clerk user info (email) if available
    const enrichedWorkers = await Promise.all(
      workers.map(async (w) => {
        const obj = w.toObject();
        if (w.authUserId && process.env.CLERK_SECRET_KEY) {
          const clerkInfo = await getClerkUserInfo(w.authUserId);
          obj.email = clerkInfo?.email || '';
          obj.imageUrl = clerkInfo?.imageUrl || null;
        }
        return obj;
      })
    );

    res.json({ success: true, staff: enrichedWorkers, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Error listing staff:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch staff directory.' });
  }
});

/**
 * GET /api/v1/staff/:id — Staff member details
 */
router.get('/staff/:id', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID.' });
    }

    const worker = await Worker.findById(id)
      .populate('organizationId', 'name type status')
      .populate('departmentId', 'name prefix roomNumber')
      .populate('counterId', 'name counterNumber status');

    if (!worker) {
      return res.status(404).json({ success: false, error: 'Staff member not found.' });
    }

    const obj = worker.toObject();
    if (worker.authUserId && process.env.CLERK_SECRET_KEY) {
      const clerkInfo = await getClerkUserInfo(worker.authUserId);
      obj.email = clerkInfo?.email || '';
      obj.imageUrl = clerkInfo?.imageUrl || null;
    }

    // Get audit history for this staff member
    const auditHistory = await AuditLog.find({
      $or: [
        { targetId: id },
        { targetId: worker.authUserId }
      ]
    }).sort({ createdAt: -1 }).limit(20);

    res.json({ success: true, staff: obj, auditHistory });
  } catch (err) {
    console.error('Error fetching staff details:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch staff details.' });
  }
});

/**
 * PATCH /api/v1/staff/:id — Update staff assignment
 */
router.patch('/staff/:id', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const adminUserId = req.auth.userId;
    const { id } = req.params;
    const { role, departmentId, counterId, name } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID.' });
    }

    const worker = await Worker.findById(id);
    if (!worker) {
      return res.status(404).json({ success: false, error: 'Staff member not found.' });
    }

    const before = { role: worker.role, departmentId: worker.departmentId, counterId: worker.counterId };
    const updates = {};

    if (name) updates.name = name.trim();
    if (role && ['WORKER', 'SUPERVISOR'].includes(role.toUpperCase())) {
      updates.role = role.toUpperCase();
    }
    if (departmentId !== undefined) {
      if (departmentId && isValidObjectId(departmentId)) {
        const dept = await Department.findOne({ _id: departmentId, orgId: worker.organizationId });
        if (!dept) return res.status(400).json({ success: false, error: 'Department not in this organization.' });
        updates.departmentId = departmentId;
      } else {
        updates.departmentId = null;
      }
    }
    if (counterId !== undefined) {
      if (counterId && isValidObjectId(counterId)) {
        const ctr = await Counter.findOne({ _id: counterId, organizationId: worker.organizationId });
        if (!ctr) return res.status(400).json({ success: false, error: 'Counter not in this organization.' });
        updates.counterId = counterId;
      } else {
        updates.counterId = null;
      }
    }

    const updated = await Worker.findByIdAndUpdate(id, updates, { returnDocument: 'after' })
      .populate('organizationId', 'name type')
      .populate('departmentId', 'name prefix')
      .populate('counterId', 'name counterNumber');

    // Update Clerk metadata
    if (worker.authUserId && process.env.CLERK_SECRET_KEY && updates.role) {
      try {
        await clerkClient.users.updateUserMetadata(worker.authUserId, {
          publicMetadata: {
            role: (updates.role || worker.role).toLowerCase(),
            departmentId: updates.departmentId?.toString() || worker.departmentId?.toString() || null,
            counterId: updates.counterId?.toString() || worker.counterId?.toString() || null
          }
        });
        invalidateUserCache(worker.authUserId);
      } catch (clerkErr) {
        console.warn('[Staff] Clerk metadata update failed:', clerkErr.message);
      }
    }

    await AuditLog.create({
      actorId: adminUserId,
      action: 'STAFF_SCOPE_CHANGED',
      targetType: 'WORKER',
      targetId: id,
      organizationId: worker.organizationId,
      details: { before, after: updates }
    });

    res.json({ success: true, message: 'Staff assignment updated.', staff: updated });
  } catch (err) {
    console.error('Error updating staff:', err);
    res.status(500).json({ success: false, error: 'Failed to update staff assignment.' });
  }
});

/**
 * POST /api/v1/staff/:id/deactivate — Deactivate a staff member
 */
router.post('/staff/:id/deactivate', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const adminUserId = req.auth.userId;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID.' });
    }

    const worker = await Worker.findById(id);
    if (!worker) return res.status(404).json({ success: false, error: 'Staff member not found.' });
    if (worker.status === 'DEACTIVATED') {
      return res.status(400).json({ success: false, error: 'Staff member is already deactivated.' });
    }

    worker.status = 'DEACTIVATED';
    await worker.save();

    // Revoke Clerk metadata role
    if (worker.authUserId && process.env.CLERK_SECRET_KEY) {
      try {
        await clerkClient.users.updateUserMetadata(worker.authUserId, {
          publicMetadata: { role: 'citizen' }
        });
        invalidateUserCache(worker.authUserId);
      } catch (clerkErr) {
        console.warn('[Staff] Clerk deactivation metadata update failed:', clerkErr.message);
      }
    }

    await AuditLog.create({
      actorId: adminUserId,
      action: 'STAFF_DEACTIVATED',
      targetType: 'WORKER',
      targetId: id,
      organizationId: worker.organizationId,
      details: { name: worker.name, role: worker.role }
    });

    res.json({ success: true, message: `${worker.name} has been deactivated.` });
  } catch (err) {
    console.error('Error deactivating staff:', err);
    res.status(500).json({ success: false, error: 'Failed to deactivate staff member.' });
  }
});

/**
 * POST /api/v1/staff/:id/reactivate — Reactivate a deactivated staff member
 */
router.post('/staff/:id/reactivate', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const adminUserId = req.auth.userId;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID.' });
    }

    const worker = await Worker.findById(id);
    if (!worker) return res.status(404).json({ success: false, error: 'Staff member not found.' });
    if (worker.status !== 'DEACTIVATED') {
      return res.status(400).json({ success: false, error: 'Staff member is not currently deactivated.' });
    }

    worker.status = 'AVAILABLE';
    await worker.save();

    // Restore Clerk metadata role
    if (worker.authUserId && process.env.CLERK_SECRET_KEY) {
      try {
        await clerkClient.users.updateUserMetadata(worker.authUserId, {
          publicMetadata: {
            role: worker.role.toLowerCase(),
            organizationId: worker.organizationId?.toString()
          }
        });
        invalidateUserCache(worker.authUserId);
      } catch (clerkErr) {
        console.warn('[Staff] Clerk reactivation metadata update failed:', clerkErr.message);
      }
    }

    await AuditLog.create({
      actorId: adminUserId,
      action: 'STAFF_REACTIVATED',
      targetType: 'WORKER',
      targetId: id,
      organizationId: worker.organizationId,
      details: { name: worker.name, role: worker.role }
    });

    res.json({ success: true, message: `${worker.name} has been reactivated.` });
  } catch (err) {
    console.error('Error reactivating staff:', err);
    res.status(500).json({ success: false, error: 'Failed to reactivate staff member.' });
  }
});

/**
 * POST /api/v1/staff/:id/revoke — Revoke organization membership
 */
router.post('/staff/:id/revoke', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const adminUserId = req.auth.userId;
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid staff ID.' });
    }

    const worker = await Worker.findById(id).populate('organizationId', 'name');
    if (!worker) return res.status(404).json({ success: false, error: 'Staff member not found.' });

    const orgName = worker.organizationId?.name || 'Unknown';

    // Soft-delete the worker by marking as DEACTIVATED, not hard delete
    // This preserves queue history
    worker.status = 'DEACTIVATED';
    await worker.save();

    // Revoke Clerk metadata
    if (worker.authUserId && process.env.CLERK_SECRET_KEY) {
      try {
        // Check if user has other active memberships
        const otherMemberships = await Worker.find({
          authUserId: worker.authUserId,
          _id: { $ne: worker._id },
          status: { $ne: 'DEACTIVATED' }
        });

        if (otherMemberships.length === 0) {
          await clerkClient.users.updateUserMetadata(worker.authUserId, {
            publicMetadata: { role: 'citizen' }
          });
        }
        invalidateUserCache(worker.authUserId);
      } catch (clerkErr) {
        console.warn('[Staff] Clerk revocation metadata update failed:', clerkErr.message);
      }
    }

    await AuditLog.create({
      actorId: adminUserId,
      action: 'STAFF_MEMBERSHIP_REVOKED',
      targetType: 'WORKER',
      targetId: id,
      organizationId: worker.organizationId?._id,
      details: { name: worker.name, role: worker.role, organizationName: orgName }
    });

    res.json({ success: true, message: `${worker.name}'s membership in ${orgName} has been revoked.` });
  } catch (err) {
    console.error('Error revoking membership:', err);
    res.status(500).json({ success: false, error: 'Failed to revoke membership.' });
  }
});

/**
 * GET /api/v1/access-requests/audit-logs — List audit logs (admin only)
 */
router.get('/audit-logs', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const { action, organizationId, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (action) filter.action = action;
    if (organizationId && isValidObjectId(organizationId)) filter.organizationId = organizationId;

    const skip = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .populate('organizationId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      AuditLog.countDocuments(filter)
    ]);

    res.json({ success: true, logs, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch audit logs.' });
  }
});

module.exports = router;

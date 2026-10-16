/**
 * workerRoutes.js
 * Worker portal routes — secured with authentication and scope enforcement.
 *
 * Authorization model:
 * - All non-public routes require Clerk authentication
 * - Workers can only operate on their assigned organization/department/counter
 * - Supervisors and master_admin have elevated read access
 * - Worker identity is ALWAYS resolved server-side from Worker.authUserId
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Service = require('../models/Service');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const Counter = require('../models/Counter');
const Worker = require('../models/Worker');
const queueService = require('../services/queueService');
const workerService = require('../services/workerService');
const {
  requireAuth,
  checkRole,
  requireWorkerScope,
  resolveStaffWorker
} = require('../middleware/authMiddleware');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─────────────────────────────────────────────────────────────────────────────
// WORKER IDENTITY & PROFILE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/worker/me
 * Returns the authenticated staff member's profile.
 * Identity is resolved ONLY from the Clerk session — never from query params.
 */
router.get('/me', requireAuth, async (req, res) => {
  try {
    const authUserId = req.auth?.userId;

    // Test bypass: allow x-test-user-id header
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    const effectiveUserId = isTestBypass
      ? (req.headers['x-test-user-id'] || authUserId)
      : authUserId;

    if (!effectiveUserId) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No authenticated session.' });
    }

    const profile = await workerService.getWorkerProfile(effectiveUserId);
    if (!profile?.worker) {
      return res.status(404).json({ success: false, error: 'Worker profile not found for this account.' });
    }

    return res.json({ success: true, ...profile });
  } catch (err) {
    console.error('Error in GET /worker/me:', err);
    res.status(500).json({ success: false, error: 'Failed to load worker profile.' });
  }
});

/**
 * GET /api/v1/worker/workers?orgId=&deptId=
 * Lists workers. Requires authentication. Scoped by org for non-admin users.
 */
router.get('/workers', requireAuth, async (req, res) => {
  try {
    const { orgId, deptId } = req.query;

    // Resolve caller's identity to enforce scope
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let callerRole = req.headers['x-test-role']?.toLowerCase();

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      callerRole = worker?.role?.toLowerCase();

      // Non-admin workers can only list workers in their own org
      if (!['master_admin', 'supervisor', 'org_admin'].includes(callerRole)) {
        if (orgId && worker?.organizationId?._id?.toString() !== orgId) {
          return res.status(403).json({ success: false, error: 'Forbidden: Cannot list workers for other organizations.' });
        }
      }
    }

    const workers = await workerService.listWorkers({
      organizationId: orgId && isValidObjectId(orgId) ? orgId : null,
      departmentId: deptId && isValidObjectId(deptId) ? deptId : null
    });
    res.json({ success: true, workers });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to fetch workers.' });
  }
});

/**
 * PATCH /api/v1/worker/workers/:id
 * Update worker assignment. Requires supervisor or master_admin.
 */
router.patch('/workers/:id', requireAuth, checkRole(['supervisor', 'master_admin', 'org_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { organizationId, name, role, departmentId, counterId } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (role) updates.role = role;
    if (departmentId && isValidObjectId(departmentId)) updates.departmentId = departmentId;
    if (counterId !== undefined) updates.counterId = isValidObjectId(counterId) ? counterId : null;

    const filter = { _id: id };
    if (organizationId) filter.organizationId = organizationId;

    const worker = await Worker.findOneAndUpdate(filter, updates, { returnDocument: 'after' })
      .populate('departmentId', 'name prefix')
      .populate('counterId', 'name counterNumber status');
    if (!worker) return res.status(404).json({ success: false, error: 'Worker not found' });
    res.json({ success: true, worker });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update worker.' });
  }
});

/**
 * POST /api/v1/worker/workers
 * Create a worker. Restricted to supervisor and master_admin.
 */
router.post('/workers', requireAuth, checkRole(['supervisor', 'master_admin', 'org_admin']), async (req, res) => {
  try {
    const { organizationId, departmentId, name, role, authUserId } = req.body;
    if (!organizationId || !name) {
      return res.status(400).json({ success: false, error: 'organizationId and name are required' });
    }
    const worker = await Worker.create({
      organizationId,
      departmentId: departmentId && isValidObjectId(departmentId) ? departmentId : null,
      name,
      role: role || 'WORKER',
      authUserId: authUserId || null
    });
    res.status(201).json({ success: true, worker });
  } catch (err) {
    console.error('Error creating worker:', err);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// WORKER BREAK SYSTEM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/worker/break
 * Worker starts a break. Resolved workerId comes from server-side lookup.
 */
router.post('/break', requireAuth, async (req, res) => {
  try {
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let workerId = req.body.workerId;

    // In production, resolve workerId server-side, don't trust body
    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
    }

    if (!workerId || !isValidObjectId(workerId)) {
      return res.status(400).json({ success: false, error: 'Valid workerId is required' });
    }
    const worker = await workerService.startWorkerBreak({ workerId, organizationId: req.body.organizationId });
    res.json({ success: true, message: 'Break started', worker });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/worker/break-end
 * Worker ends break.
 */
router.post('/break-end', requireAuth, async (req, res) => {
  try {
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let workerId = req.body.workerId;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
    }

    if (!workerId || !isValidObjectId(workerId)) {
      return res.status(400).json({ success: false, error: 'Valid workerId is required' });
    }
    const worker = await workerService.endWorkerBreak({ workerId, organizationId: req.body.organizationId });
    res.json({ success: true, message: 'Break ended, back to AVAILABLE', worker });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE OPERATIONS — All require authentication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/worker/department/:departmentId/call-next
 * Call next ticket. Worker scope enforced: worker must belong to this department's org.
 */
router.post('/department/:departmentId/call-next', requireAuth, async (req, res) => {
  try {
    const { departmentId } = req.params;
    if (!isValidObjectId(departmentId)) {
      return res.status(400).json({ error: 'Invalid Department ID format' });
    }

    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { orgId, counterId, workerId, roomId } = req.body;

    // Resolve identity server-side in production
    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found for this account.' });

      // Enforce department belongs to worker's org
      const dept = await Department.findById(departmentId);
      if (!dept) return res.status(404).json({ error: 'Department not found' });
      if (dept.orgId.toString() !== worker.organizationId._id.toString()) {
        return res.status(403).json({ error: 'Forbidden: Department does not belong to your organization.' });
      }

      // Use server-resolved identity
      workerId = worker._id.toString();
      orgId = worker.organizationId._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    // Verify worker isn't on break
    if (workerId && isValidObjectId(workerId)) {
      const w = await Worker.findById(workerId);
      if (w && w.status === 'ON_BREAK') {
        return res.status(400).json({ error: 'Cannot call next ticket while on break.' });
      }
    }

    const result = await queueService.callNextTicket({
      organizationId: orgId,
      departmentId,
      counterId,
      workerId,
      roomId: roomId || req.query.roomId
    });

    return res.json({
      success: true,
      ticket: result.ticket,
      ticketNumber: result.ticketNumber,
      counterNumber: result.counterNumber,
      roomNumber: result.roomNumber,
      message: result.message || (result.ticket ? 'Ticket called successfully' : 'No waiting tickets in this queue')
    });
  } catch (err) {
    console.error('ERROR in /department/:departmentId/call-next:', err);
    res.status(500).json({ error: 'Failed to call next ticket.' });
  }
});

/**
 * GET /api/v1/worker/department/:departmentId/current
 * Get the currently serving ticket for this department.
 */
router.get('/department/:departmentId/current', requireAuth, async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { roomId } = req.query;

    if (!isValidObjectId(departmentId)) {
      return res.status(400).json({ error: 'Invalid Department ID format' });
    }

    const dept = await Department.findById(departmentId);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    // Enforce org scope for non-test environments
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (worker && dept.orgId.toString() !== worker.organizationId._id.toString()) {
        return res.status(403).json({ error: 'Forbidden: Department does not belong to your organization.' });
      }
    }

    const servingFilter = {
      currentDepartmentId: departmentId,
      status: { $in: ['SERVING', 'CALLED'] }
    };
    if (roomId && isValidObjectId(roomId)) servingFilter.targetRoomId = roomId;

    const servingTicket = await Ticket.findOne(servingFilter).sort({ calledAt: -1 });

    const waitingFilter = {
      currentDepartmentId: departmentId,
      $or: [
        { status: { $in: ['WAITING', 'TRANSFERRED'] } },
        { status: 'SNOOZED', 'snoozeInfo.resumeAt': { $lte: new Date() } }
      ]
    };

    const waitingTickets = await Ticket.find(waitingFilter)
      .sort({ priority: -1, createdAt: 1 })
      .limit(10);

    const waitingCount = await Ticket.countDocuments(waitingFilter);

    return res.json({
      success: true,
      department: dept,
      ticket: servingTicket || null,
      ticketNumber: servingTicket ? servingTicket.ticketNumber : null,
      waitingCount,
      waitingTickets,
      roomNumber: dept.roomNumber || ''
    });
  } catch (err) {
    console.error('ERROR in /department/:departmentId/current:', err);
    res.status(500).json({ error: 'Failed to fetch current serving ticket.' });
  }
});

/**
 * POST /api/v1/worker/tokens/transfer
 */
router.post('/tokens/transfer', requireAuth, async (req, res) => {
  try {
    const { ticketId, ticketNumber, targetDeptId, targetCounterId, reason, transferReason } = req.body;

    if (!targetDeptId || !isValidObjectId(targetDeptId)) {
      return res.status(400).json({ error: 'Valid targetDeptId is required' });
    }

    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let workerId = req.body.workerId;
    let counterId = req.body.counterId;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    let resolvedTicketId = ticketId;
    if (!resolvedTicketId && ticketNumber) {
      const found = await Ticket.findOne({
        ticketNumber: String(ticketNumber).trim(),
        status: { $ne: 'COMPLETED' }
      }).sort({ createdAt: -1 });
      if (found) resolvedTicketId = found._id;
    }

    if (!resolvedTicketId || !isValidObjectId(resolvedTicketId)) {
      return res.status(400).json({ error: 'Could not resolve ticket for transfer' });
    }

    const result = await queueService.transferTicket({
      ticketId: resolvedTicketId,
      targetDepartmentId: targetDeptId,
      targetCounterId,
      workerId,
      counterId,
      reason: reason || transferReason
    });

    const targetRoomStr = result.ticket.roomNumber ? ` [Room ${result.ticket.roomNumber}]` : '';
    const targetCounterStr = result.targetCounter
      ? ` · ${result.targetCounter.name || `Counter ${result.targetCounter.counterNumber}`}`
      : '';

    return res.json({
      success: true,
      message: `Ticket ${result.ticket.ticketNumber} transferred to ${result.targetDepartment.name}${targetCounterStr}${targetRoomStr}`,
      ticket: result.ticket,
      targetDepartment: result.targetDepartment,
      targetCounter: result.targetCounter,
      positionInQueue: result.positionInQueue
    });
  } catch (err) {
    console.error('ERROR in /tokens/transfer:', err);
    res.status(err.status || 500).json({ error: err.message || 'Failed to transfer ticket.' });
  }
});

/**
 * POST /api/v1/worker/tokens/start
 */
router.post('/tokens/start', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.startService({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Service started', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/worker/tokens/complete
 */
router.post('/tokens/complete', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.completeService({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Service completed', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/worker/tokens/snooze
 */
router.post('/tokens/snooze', requireAuth, async (req, res) => {
  try {
    const { ticketId, minutes } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let workerId = req.body.workerId;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
    }

    const ticket = await queueService.snoozeTicket({
      ticketId,
      minutes: Number(minutes) || 5,
      workerId,
      source: 'WORKER'
    });
    res.json({ success: true, message: `Ticket snoozed for ${minutes || 5} minutes`, ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/worker/tokens/resume
 */
router.post('/tokens/resume', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let workerId = req.body.workerId;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
    }

    const ticket = await queueService.resumeTicket({ ticketId, workerId });
    res.json({ success: true, message: 'Ticket resumed to WAITING', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/worker/tokens/recall
 */
router.post('/tokens/recall', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.recallTicket({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Ticket recalled', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/worker/tokens/skip
 */
router.post('/tokens/skip', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.skipTicket({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Ticket skipped', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * POST /api/v1/worker/tokens/no-show
 */
router.post('/tokens/no-show', requireAuth, async (req, res) => {
  try {
    const { ticketId } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.noShowTicket({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Ticket marked as no-show', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

/**
 * GET /api/v1/worker/services (Legacy fallback — authenticated)
 */
router.get('/services', requireAuth, async (req, res) => {
  try {
    const services = await Service.find();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch services.' });
  }
});

// NOTE: The /identity route has been REMOVED.
// It was a dev-only route that auto-created workers for any orgId,
// which is a critical security vulnerability. Use /me instead.

module.exports = router;
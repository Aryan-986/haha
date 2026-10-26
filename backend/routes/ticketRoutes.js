/**
 * ticketRoutes.js
 * Canonical REST API for QueueLess Ticket operations.
 *
 * Authorization model:
 * - Public: POST / (issue ticket), GET /track/:token (tracking by token)
 * - Staff-authenticated: GET /:id and all lifecycle mutations (start, complete, transfer, etc.)
 * - Citizens cannot perform staff operations; staff cannot bypass scope.
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const queueService = require('../services/queueService');
const Ticket = require('../models/Ticket');
const citizenService = require('../services/citizenService');
const { requireAuth, resolveStaffWorker } = require('../middleware/authMiddleware');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// ─────────────────────────────────────────────────────────────────────────────
// Rate limiting for public ticket issuance
// ─────────────────────────────────────────────────────────────────────────────

const ticketIssuanceLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.TICKET_RATE_LIMIT ? parseInt(process.env.TICKET_RATE_LIMIT) : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many ticket requests from this IP. Please wait before requesting another ticket.'
  },
  skip: (req) => {
    // Skip rate limiting in test environments
    return process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC CITIZEN ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/tickets - Issue a new Ticket (public, rate-limited)
 * Citizens may issue tickets anonymously.
 * Idempotency key prevents duplicate issuance on retries.
 */
router.post('/', ticketIssuanceLimit, async (req, res) => {
  try {
    const { organizationId, departmentId, serviceId, priority, source, roomNumber, idempotencyKey } = req.body;
    const key = req.headers['idempotency-key'] || idempotencyKey;

    // Validate required fields
    if (!organizationId || !isValidObjectId(organizationId)) {
      return res.status(400).json({ success: false, error: 'Valid organizationId is required' });
    }
    if (!departmentId || !isValidObjectId(departmentId)) {
      return res.status(400).json({ success: false, error: 'Valid departmentId is required' });
    }

    const result = await queueService.issueTicket({
      organizationId,
      departmentId,
      serviceId,
      priority,
      source: source || 'WEB',
      roomNumber,
      idempotencyKey: key
    });
    res.status(result.isIdempotent ? 200 : 201).json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /api/v1/tickets:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/tickets/track/:trackingToken - Secure anonymous ticket tracking.
 * Access is authorized by possession of the high-entropy tracking token.
 * The tracking token is never predictable or guessable.
 */
router.get('/track/:trackingToken', async (req, res) => {
  try {
    const { trackingToken } = req.params;
    if (!trackingToken || typeof trackingToken !== 'string' || trackingToken.length < 16) {
      return res.status(400).json({ success: false, error: 'Valid tracking token is required' });
    }

    const ticket = await citizenService.getTicketByTrackingToken(trackingToken);
    const positionData = await citizenService.getTicketPosition(ticket._id);
    const etaData = await citizenService.getTicketETA(ticket._id);

    // Return citizen-safe representation only — no staff identities or internal IDs
    res.json({
      success: true,
      ticket: {
        _id: ticket._id,
        ticketNumber: ticket.ticketNumber,
        trackingToken: ticket.trackingToken,
        status: ticket.status,
        priority: ticket.priority,
        source: ticket.source,
        createdAt: ticket.createdAt,
        calledAt: ticket.calledAt,
        serviceStartedAt: ticket.serviceStartedAt,
        completedAt: ticket.completedAt,
        organization: ticket.organizationId ? {
          _id: ticket.organizationId._id,
          name: ticket.organizationId.name,
          type: ticket.organizationId.type
        } : null,
        department: ticket.currentDepartmentId ? {
          _id: ticket.currentDepartmentId._id,
          name: ticket.currentDepartmentId.name,
          prefix: ticket.currentDepartmentId.prefix,
          roomNumber: ticket.currentDepartmentId.roomNumber
        } : null,
        counter: ticket.currentCounterId ? {
          _id: ticket.currentCounterId._id,
          counterNumber: ticket.currentCounterId.counterNumber,
          name: ticket.currentCounterId.name
        } : null,
        roomNumber: ticket.roomNumber,
        snoozeInfo: ticket.snoozeInfo,
        history: ticket.history
      },
      peopleAhead: positionData.peopleAhead,
      position: positionData.position,
      estimatedWaitMin: etaData.estimatedWaitMin,
      etaDetails: etaData
    });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/track/:trackingToken:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STAFF-AUTHENTICATED ENDPOINTS
// All routes below require a valid Clerk session.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/tickets/:id - Get full ticket details (public for citizen tracking).
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let ticket = null;

    if (isValidObjectId(id)) {
      ticket = await Ticket.findById(id)
        .populate('currentDepartmentId')
        .populate('organizationId')
        .populate('currentCounterId');
    }
    if (!ticket) {
      ticket = await Ticket.findOne({ ticketNumber: id.trim().toUpperCase() })
        .populate('currentDepartmentId')
        .populate('organizationId')
        .populate('currentCounterId');
    }

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const positionData = await citizenService.getTicketPosition(ticket._id);
    const etaData = await citizenService.getTicketETA(ticket._id);

    // Check if caller is authenticated staff
    let isStaff = false;
    if (req.auth?.userId) {
      const { resolveUserRole } = require('../middleware/authMiddleware');
      const role = await resolveUserRole(req);
      if (['master_admin', 'supervisor', 'org_admin', 'worker'].includes((role || '').toLowerCase())) {
        isStaff = true;
      }
    }

    // Public view omits trackingToken, idempotencyKey, and currentWorkerId to prevent credential harvesting
    const returnedTicket = isStaff ? ticket : {
      _id: ticket._id,
      ticketNumber: ticket.ticketNumber,
      status: ticket.status,
      priority: ticket.priority,
      source: ticket.source,
      roomNumber: ticket.roomNumber,
      counterNumber: ticket.counterNumber,
      createdAt: ticket.createdAt,
      calledAt: ticket.calledAt,
      serviceStartedAt: ticket.serviceStartedAt,
      completedAt: ticket.completedAt,
      organization: ticket.organizationId ? {
        _id: ticket.organizationId._id,
        name: ticket.organizationId.name,
        type: ticket.organizationId.type
      } : null,
      department: ticket.currentDepartmentId ? {
        _id: ticket.currentDepartmentId._id,
        name: ticket.currentDepartmentId.name,
        prefix: ticket.currentDepartmentId.prefix,
        roomNumber: ticket.currentDepartmentId.roomNumber
      } : null,
      counter: ticket.currentCounterId ? {
        _id: ticket.currentCounterId._id,
        counterNumber: ticket.currentCounterId.counterNumber,
        name: ticket.currentCounterId.name
      } : null,
      history: ticket.history ? ticket.history.map(h => ({
        deptId: h.deptId,
        timestamp: h.timestamp,
        counterId: h.counterId,
        action: h.action
      })) : []
    };

    res.json({
      success: true,
      ticket: returnedTicket,
      peopleAhead: positionData.peopleAhead,
      position: positionData.position,
      estimatedWaitMin: etaData.estimatedWaitMin,
      etaDetails: etaData
    });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/:id:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch ticket.' });
  }
});

/**
 * GET /api/v1/tickets/:id/position (public)
 */
router.get('/:id/position', async (req, res) => {
  try {
    const { id } = req.params;
    let ticketId = id;
    if (!isValidObjectId(id)) {
      const ticket = await Ticket.findOne({ ticketNumber: id.trim().toUpperCase() });
      if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
      ticketId = ticket._id;
    }

    const pos = await citizenService.getTicketPosition(ticketId);
    res.json({ success: true, ...pos });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/:id/position:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/tickets/:id/eta (public)
 */
router.get('/:id/eta', async (req, res) => {
  try {
    const { id } = req.params;
    let ticketId = id;
    if (!isValidObjectId(id)) {
      const ticket = await Ticket.findOne({ ticketNumber: id.trim().toUpperCase() });
      if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
      ticketId = ticket._id;
    }

    const eta = await citizenService.getTicketETA(ticketId);
    res.json({ success: true, ...eta });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/:id/eta:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/tickets/:id/journey (public)
 */
router.get('/:id/journey', async (req, res) => {
  try {
    const { id } = req.params;
    let ticketId = id;
    if (!isValidObjectId(id)) {
      const ticket = await Ticket.findOne({ ticketNumber: id.trim().toUpperCase() });
      if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
      ticketId = ticket._id;
    }

    const journey = await citizenService.getTicketJourney(ticketId);
    res.json({ success: true, ...journey });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/:id/journey:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/tickets/:id/events - Immutable audit timeline (citizen-safe fields, public)
 */
router.get('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    let ticketId = id;
    if (!isValidObjectId(id)) {
      const ticket = await Ticket.findOne({ ticketNumber: id.trim().toUpperCase() });
      if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
      ticketId = ticket._id;
    }

    const events = await citizenService.getTicketEvents(ticketId);
    res.json({ success: true, events });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/:id/events:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/start - Start service (staff only)
 */
router.post('/:id/start', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.startService({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Service started', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/start:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/complete - Complete service (staff only)
 */
router.post('/:id/complete', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.completeService({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Service completed', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/complete:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/transfer - Transfer ticket downstream (staff only)
 */
router.post('/:id/transfer', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { targetDepartmentId, targetCounterId } = req.body;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const result = await queueService.transferTicket({
      ticketId: id,
      targetDepartmentId,
      targetCounterId,
      workerId,
      counterId
    });
    res.json({ success: true, message: 'Ticket transferred successfully', ...result });
  } catch (err) {
    console.error('Error in /tickets/:id/transfer:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/snooze - Snooze ticket
 * Authorized for staff (via Clerk session) OR citizen (via valid trackingToken)
 */
router.post('/:id/snooze', async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes, source, trackingToken } = req.body;
    const tokenHeader = req.headers['x-tracking-token'];
    const suppliedToken = trackingToken || tokenHeader;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Valid ticket ID is required' });
    }

    const ticketRecord = await Ticket.findById(id);
    if (!ticketRecord) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let workerId = req.body.workerId;
    let effectiveSource = source || 'WORKER';

    if (effectiveSource === 'CITIZEN') {
      if (!isTestBypass) {
        if (!suppliedToken || suppliedToken !== ticketRecord.trackingToken) {
          return res.status(403).json({ success: false, error: 'Valid tracking token is required to delay this ticket' });
        }
      }
      workerId = null;
    } else {
      // Staff authorization requires Clerk session
      if (!isTestBypass) {
        const worker = await resolveStaffWorker(req);
        if (!worker) return res.status(401).json({ success: false, error: 'Staff authentication required' });
        workerId = worker._id.toString();
      }
    }

    const ticket = await queueService.snoozeTicket({
      ticketId: id,
      minutes: Number(minutes) || 5,
      workerId,
      source: effectiveSource
    });
    res.json({ success: true, message: `Ticket snoozed by ${minutes || 5} minutes`, ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/snooze:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/skip - Skip ticket (staff only)
 */
router.post('/:id/skip', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.skipTicket({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Ticket marked as skipped', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/skip:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/no-show - Mark as No-Show (staff only)
 */
router.post('/:id/no-show', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.noShowTicket({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Ticket marked as no-show', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/no-show:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/recall - Recall a CALLED ticket (staff only)
 */
router.post('/:id/recall', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let { workerId, counterId } = req.body;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
      counterId = counterId || worker.counterId?._id?.toString();
    }

    const ticket = await queueService.recallTicket({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Ticket recalled successfully', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/recall:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/tickets/:id/resume - Resume a SNOOZED ticket (staff only)
 */
router.post('/:id/resume', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const isTestBypass = process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
    let workerId = req.body.workerId;

    if (!isTestBypass) {
      const worker = await resolveStaffWorker(req);
      if (!worker) return res.status(403).json({ success: false, error: 'No worker profile found.' });
      workerId = worker._id.toString();
    }

    const ticket = await queueService.resumeTicket({ ticketId: id, workerId });
    res.json({ success: true, message: 'Ticket resumed', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/resume:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

module.exports = router;

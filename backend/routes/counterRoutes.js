/**
 * counterRoutes.js
 * Counter lifecycle management — Phase 2
 * GET/POST /api/v1/counters
 * PATCH /api/v1/counters/:id
 * POST /api/v1/counters/:id/break
 * POST /api/v1/counters/:id/resume
 * POST /api/v1/counters/:id/offline
 * POST /api/v1/counters/:id/activate
 * POST /api/v1/counters/:id/assign-worker
 * POST /api/v1/counters/:id/unassign-worker
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Counter = require('../models/Counter');
const counterService = require('../services/counterService');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

const Worker = require('../models/Worker');
const Ticket = require('../models/Ticket');
const { emitQueueEvent } = require('../socket');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: resolve organizationId from body or query
const getOrgId = (req) => req.body?.organizationId || req.query?.organizationId || null;
const getWorkerId = (req) => req.body?.workerId || req.query?.workerId || null;

// GET /api/v1/counters?organizationId=&departmentId= (Public/read)
router.get('/', async (req, res) => {
  try {
    const { organizationId, departmentId } = req.query;
    const filter = {};
    if (organizationId && isValidObjectId(organizationId)) filter.organizationId = organizationId;
    if (departmentId && isValidObjectId(departmentId)) filter.departmentId = departmentId;

    const counters = await Counter.find(filter)
      .populate('assignedWorkerId', 'name role status authUserId')
      .populate('currentTicketId', 'ticketNumber status priority')
      .sort({ departmentId: 1, counterNumber: 1 });

    res.json({ success: true, counters });
  } catch (err) {
    console.error('Error in GET /counters:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/counters/:id
router.get('/:id', async (req, res) => {
  try {
    const counter = await Counter.findById(req.params.id)
      .populate('assignedWorkerId', 'name role status')
      .populate('currentTicketId', 'ticketNumber status priority calledAt serviceStartedAt');
    if (!counter) return res.status(404).json({ success: false, error: 'Counter not found' });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters - Create counter (Admin/Supervisor only)
router.post('/', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { organizationId, departmentId, counterNumber, name, roomNumber, status, isActive } = req.body;
    if (!organizationId || !departmentId || !counterNumber) {
      return res.status(400).json({ success: false, error: 'organizationId, departmentId, and counterNumber are required' });
    }
    const counter = await counterService.createCounter({
      organizationId,
      departmentId,
      counterNumber,
      name,
      roomNumber,
      status: status || 'AVAILABLE',
      isActive: isActive !== undefined ? isActive : true
    });
    res.status(201).json({ success: true, counter });
  } catch (err) {
    console.error('Error in POST /counters:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/counters/:id - Update counter (Admin/Supervisor only)
router.patch('/:id', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { name, counterNumber, roomNumber, status, isActive } = req.body;
    const existing = await Counter.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, error: 'Counter not found' });

    const updates = {};
    if (name !== undefined) updates.name = String(name).trim();
    if (roomNumber !== undefined) updates.roomNumber = String(roomNumber).trim();
    if (status !== undefined) updates.status = status;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    if (counterNumber !== undefined && Number(counterNumber) !== existing.counterNumber) {
      const duplicate = await Counter.findOne({
        departmentId: existing.departmentId,
        counterNumber: Number(counterNumber),
        _id: { $ne: existing._id }
      });
      if (duplicate) {
        return res.status(400).json({ success: false, error: `Counter ${counterNumber} already exists in this department.` });
      }
      updates.counterNumber = Number(counterNumber);
    }

    const counter = await Counter.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' })
      .populate('assignedWorkerId', 'name role status authUserId')
      .populate('currentTicketId', 'ticketNumber status priority');

    emitQueueEvent('counter.updated', {
      orgId: counter.organizationId.toString(),
      deptId: counter.departmentId.toString(),
      counter,
      event: 'counter.updated'
    });

    res.json({ success: true, counter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/counters/:id - Safely remove a counter (Admin/Supervisor only)
router.delete('/:id', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const counter = await Counter.findById(req.params.id);
    if (!counter) return res.status(404).json({ success: false, error: 'Counter not found' });

    // Safety check 1: Active ticket being served at this counter
    const activeTicket = await Ticket.findOne({
      currentCounterId: counter._id,
      status: { $in: ['SERVING', 'CALLED'] }
    });
    if (activeTicket) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete counter: Ticket #${activeTicket.ticketNumber} is currently actively being served at this counter.`
      });
    }

    // Safety check 2: Unassign worker if any
    if (counter.assignedWorkerId) {
      await Worker.findByIdAndUpdate(counter.assignedWorkerId, {
        counterId: null,
        status: 'AVAILABLE'
      });
    }

    await Counter.findByIdAndDelete(req.params.id);

    emitQueueEvent('counter.updated', {
      orgId: counter.organizationId.toString(),
      deptId: counter.departmentId.toString(),
      counterId: counter._id.toString(),
      event: 'counter.deleted'
    });

    res.json({ success: true, message: `Counter ${counter.counterNumber} deleted successfully.` });
  } catch (err) {
    console.error('Error in DELETE /counters/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/assign-worker (Admin/Supervisor only)
router.post('/:id/assign-worker', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { workerId, organizationId } = req.body;
    if (!workerId || !organizationId) {
      return res.status(400).json({ success: false, error: 'workerId and organizationId are required' });
    }
    const result = await counterService.assignWorker({
      counterId: req.params.id,
      workerId,
      organizationId
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in /counters/:id/assign-worker:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/unassign-worker (Admin/Supervisor only)
router.post('/:id/unassign-worker', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const counter = await counterService.unassignWorker({
      counterId: req.params.id,
      organizationId
    });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/activate (Admin/Supervisor only)
router.post('/:id/activate', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const counter = await counterService.activateCounter({
      counterId: req.params.id,
      organizationId
    });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/break (Staff)
router.post('/:id/break', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), async (req, res) => {
  try {
    const { organizationId, workerId } = req.body;
    const counter = await counterService.counterBreak({
      counterId: req.params.id,
      organizationId,
      workerId
    });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/resume (Staff)
router.post('/:id/resume', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), async (req, res) => {
  try {
    const { organizationId, workerId } = req.body;
    const counter = await counterService.resumeCounter({
      counterId: req.params.id,
      organizationId,
      workerId
    });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/offline (Staff)
router.post('/:id/offline', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const counter = await counterService.offlineCounter({
      counterId: req.params.id,
      organizationId
    });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/pause (Staff)
router.post('/:id/pause', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), async (req, res) => {
  try {
    const organizationId = getOrgId(req);
    const counter = await counterService.pauseCounter({
      counterId: req.params.id,
      organizationId
    });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

module.exports = router;

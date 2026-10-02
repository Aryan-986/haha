/**
 * workerRoutes.js
 * Worker portal routes backed by QueueService & WorkerService — Phase 2
 * Fully operational lifecycle: call → start → complete + break + recall + snooze + transfer + skip + no-show
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

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// -------------------------------------------------------------------
// WORKER IDENTITY & PROFILE
// -------------------------------------------------------------------

// GET /api/v1/worker/me - Get worker profile from authUserId (or fallback)
router.get('/me', async (req, res) => {
  try {
    const authUserId = req.auth?.userId || req.query.authUserId;
    const { orgId } = req.query;

    let worker = null;

    if (authUserId) {
      const profile = await workerService.getWorkerProfile(authUserId);
      if (profile?.worker) {
        return res.json({ success: true, ...profile });
      }
    }

    // Fallback: find by orgId (dev mode)
    if (orgId && isValidObjectId(orgId)) {
      worker = await Worker.findOne({ organizationId: orgId })
        .populate('organizationId', 'name type')
        .populate('departmentId', 'name prefix roomNumber avgServiceTimeMins')
        .populate('counterId', 'name counterNumber status currentTicketId isActive');
    }

    if (!worker) {
      return res.status(404).json({ success: false, error: 'Worker profile not found' });
    }

    let currentTicket = null;
    if (worker.counterId?.currentTicketId) {
      currentTicket = await Ticket.findById(worker.counterId.currentTicketId)
        .populate('currentDepartmentId', 'name prefix');
    }

    res.json({ success: true, worker, currentTicket });
  } catch (err) {
    console.error('Error in GET /worker/me:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/worker/identity - Legacy compat (dev only)
router.get('/identity', async (req, res) => {
  try {
    const { orgId, authUserId, name } = req.query;
    if (!orgId || !isValidObjectId(orgId)) {
      return res.status(400).json({ error: 'Valid orgId is required' });
    }

    let worker = null;
    if (authUserId) {
      worker = await Worker.findOne({ organizationId: orgId, authUserId });
    }
    if (!worker) {
      worker = await Worker.findOne({ organizationId: orgId });
    }
    if (!worker) {
      worker = await Worker.create({
        organizationId: orgId,
        name: name || 'Desk Worker',
        role: 'WORKER'
      });
    }

    res.json(worker);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/v1/worker/workers?orgId=&deptId= - List workers
router.get('/workers', async (req, res) => {
  try {
    const { orgId, deptId } = req.query;
    const workers = await workerService.listWorkers({
      organizationId: orgId && isValidObjectId(orgId) ? orgId : null,
      departmentId: deptId && isValidObjectId(deptId) ? deptId : null
    });
    res.json({ success: true, workers });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/worker/workers/:id - Update worker
router.patch('/workers/:id', async (req, res) => {
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
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/worker/workers - Create worker
router.post('/workers', async (req, res) => {
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

// -------------------------------------------------------------------
// WORKER BREAK SYSTEM
// -------------------------------------------------------------------

// POST /api/v1/worker/break - Worker starts break
router.post('/break', async (req, res) => {
  try {
    const { workerId, organizationId } = req.body;
    if (!workerId || !isValidObjectId(workerId)) {
      return res.status(400).json({ success: false, error: 'Valid workerId is required' });
    }
    const worker = await workerService.startWorkerBreak({ workerId, organizationId });
    res.json({ success: true, message: 'Break started', worker });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/worker/break-end - Worker ends break
router.post('/break-end', async (req, res) => {
  try {
    const { workerId, organizationId } = req.body;
    if (!workerId || !isValidObjectId(workerId)) {
      return res.status(400).json({ success: false, error: 'Valid workerId is required' });
    }
    const worker = await workerService.endWorkerBreak({ workerId, organizationId });
    res.json({ success: true, message: 'Break ended, back to AVAILABLE', worker });
  } catch (err) {
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------------
// QUEUE OPERATIONS
// -------------------------------------------------------------------

// POST /api/v1/worker/department/:departmentId/call-next
router.post('/department/:departmentId/call-next', async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { orgId, counterId, workerId, roomId } = req.body;

    if (!isValidObjectId(departmentId)) {
      return res.status(400).json({ error: 'Invalid Department ID format' });
    }

    // Verify worker isn't on break
    if (workerId && isValidObjectId(workerId)) {
      const w = await Worker.findById(workerId);
      if (w && w.status === 'ON_BREAK') {
        return res.status(400).json({ error: 'Cannot call next while on break' });
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
    res.status(500).json({ error: 'Failed to call next ticket', details: err.message });
  }
});

// GET /api/v1/worker/department/:departmentId/current
router.get('/department/:departmentId/current', async (req, res) => {
  try {
    const { departmentId } = req.params;
    const { roomId } = req.query;

    if (!isValidObjectId(departmentId)) {
      return res.status(400).json({ error: 'Invalid Department ID format' });
    }

    const dept = await Department.findById(departmentId);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

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
    res.status(500).json({ error: 'Failed to fetch current serving ticket', details: err.message });
  }
});

// POST /api/v1/worker/tokens/transfer
router.post('/tokens/transfer', async (req, res) => {
  try {
    const { ticketId, ticketNumber, targetDeptId, workerId, counterId } = req.body;

    if (!targetDeptId || !isValidObjectId(targetDeptId)) {
      return res.status(400).json({ error: 'Valid targetDeptId is required' });
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
      workerId,
      counterId
    });

    const targetRoomStr = result.targetDepartment?.roomNumber ? ` [Room ${result.targetDepartment.roomNumber}]` : '';

    return res.json({
      success: true,
      message: `Ticket ${result.ticket.ticketNumber} transferred to ${result.targetDepartment.name}${targetRoomStr}`,
      ticket: result.ticket,
      targetDepartment: result.targetDepartment,
      positionInQueue: result.positionInQueue
    });
  } catch (err) {
    console.error('ERROR in /tokens/transfer:', err);
    res.status(err.status || 500).json({ error: 'Failed to transfer ticket', details: err.message });
  }
});

// POST /api/v1/worker/tokens/start
router.post('/tokens/start', async (req, res) => {
  try {
    const { ticketId, workerId, counterId } = req.body;
    const ticket = await queueService.startService({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Service started', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/v1/worker/tokens/complete
router.post('/tokens/complete', async (req, res) => {
  try {
    const { ticketId, workerId, counterId } = req.body;
    const ticket = await queueService.completeService({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Service completed', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/v1/worker/tokens/snooze
router.post('/tokens/snooze', async (req, res) => {
  try {
    const { ticketId, minutes, workerId } = req.body;
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

// POST /api/v1/worker/tokens/resume
router.post('/tokens/resume', async (req, res) => {
  try {
    const { ticketId, workerId } = req.body;
    const ticket = await queueService.resumeTicket({ ticketId, workerId });
    res.json({ success: true, message: 'Ticket resumed to WAITING', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/v1/worker/tokens/recall
router.post('/tokens/recall', async (req, res) => {
  try {
    const { ticketId, workerId, counterId } = req.body;
    const ticket = await queueService.recallTicket({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Ticket recalled', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/v1/worker/tokens/skip
router.post('/tokens/skip', async (req, res) => {
  try {
    const { ticketId, workerId, counterId } = req.body;
    const ticket = await queueService.skipTicket({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Ticket skipped', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// POST /api/v1/worker/tokens/no-show
router.post('/tokens/no-show', async (req, res) => {
  try {
    const { ticketId, workerId, counterId } = req.body;
    const ticket = await queueService.noShowTicket({ ticketId, workerId, counterId });
    res.json({ success: true, message: 'Ticket marked as no-show', ticket });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

// GET /api/v1/worker/services (Legacy fallback)
router.get('/services', async (req, res) => {
  try {
    const services = await Service.find();
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch services', details: err.message });
  }
});

module.exports = router;
/**
 * ticketRoutes.js
 * Clean canonical REST API for QueueLess Ticket operations
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const queueService = require('../services/queueService');
const Ticket = require('../models/Ticket');
const citizenService = require('../services/citizenService');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// POST /api/v1/tickets - Issue a new Ticket
router.post('/', async (req, res) => {
  try {
    const { organizationId, departmentId, serviceId, priority, source, roomNumber, idempotencyKey } = req.body;
    const key = req.headers['idempotency-key'] || idempotencyKey;

    const result = await queueService.issueTicket({
      organizationId,
      departmentId,
      serviceId,
      priority,
      source,
      roomNumber,
      idempotencyKey: key
    });
    res.status(result.isIdempotent ? 200 : 201).json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /api/v1/tickets:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/tickets/track/:trackingToken - Secure anonymous ticket tracking
router.get('/track/:trackingToken', async (req, res) => {
  try {
    const { trackingToken } = req.params;
    if (!trackingToken || typeof trackingToken !== 'string') {
      return res.status(400).json({ success: false, error: 'Valid tracking token is required' });
    }

    const ticket = await citizenService.getTicketByTrackingToken(trackingToken);
    const positionData = await citizenService.getTicketPosition(ticket._id);
    const etaData = await citizenService.getTicketETA(ticket._id);

    // Return citizen-safe representation
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

// GET /api/v1/tickets/:id - Get Ticket details and dynamic priority-aware position
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

    res.json({
      success: true,
      ticket,
      peopleAhead: positionData.peopleAhead,
      position: positionData.position,
      estimatedWaitMin: etaData.estimatedWaitMin,
      etaDetails: etaData
    });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/:id:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/tickets/:id/position - Real priority-aware queue position
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

// GET /api/v1/tickets/:id/eta - Live calculated waiting time
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

// GET /api/v1/tickets/:id/journey - Multi-department journey stages
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

// GET /api/v1/tickets/:id/events - Immutable QueueEvent audit timeline (safe fields)
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

// POST /api/v1/tickets/:id/start - Start service
router.post('/:id/start', async (req, res) => {
  try {
    const { id } = req.params;
    const { workerId, counterId } = req.body;
    const ticket = await queueService.startService({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Service started', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/start:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/tickets/:id/complete - Complete service
router.post('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { workerId, counterId } = req.body;
    const ticket = await queueService.completeService({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Service completed', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/complete:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/tickets/:id/transfer - Transfer ticket downstream
router.post('/:id/transfer', async (req, res) => {
  try {
    const { id } = req.params;
    const { targetDepartmentId, targetCounterId, workerId, counterId } = req.body;
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

// POST /api/v1/tickets/:id/snooze - Snooze ticket
router.post('/:id/snooze', async (req, res) => {
  try {
    const { id } = req.params;
    const { minutes, workerId } = req.body;
    const ticket = await queueService.snoozeTicket({
      ticketId: id,
      minutes: Number(minutes) || 5,
      workerId
    });
    res.json({ success: true, message: `Ticket snoozed by ${minutes || 5} minutes`, ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/snooze:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/tickets/:id/skip - Skip ticket
router.post('/:id/skip', async (req, res) => {
  try {
    const { id } = req.params;
    const { workerId, counterId } = req.body;
    const ticket = await queueService.skipTicket({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Ticket marked as skipped', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/skip:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/tickets/:id/no-show - Mark as No-Show
router.post('/:id/no-show', async (req, res) => {
  try {
    const { id } = req.params;
    const { workerId, counterId } = req.body;
    const ticket = await queueService.noShowTicket({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Ticket marked as no-show', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/no-show:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/tickets/:id/recall - Recall a CALLED ticket (re-announce)
router.post('/:id/recall', async (req, res) => {
  try {
    const { id } = req.params;
    const { workerId, counterId } = req.body;
    const ticket = await queueService.recallTicket({ ticketId: id, workerId, counterId });
    res.json({ success: true, message: 'Ticket recalled successfully', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/recall:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// POST /api/v1/tickets/:id/resume - Resume a SNOOZED ticket back to WAITING
router.post('/:id/resume', async (req, res) => {
  try {
    const { id } = req.params;
    const { workerId } = req.body;
    const ticket = await queueService.resumeTicket({ ticketId: id, workerId });
    res.json({ success: true, message: 'Ticket resumed', ticket });
  } catch (err) {
    console.error('Error in /tickets/:id/resume:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

module.exports = router;


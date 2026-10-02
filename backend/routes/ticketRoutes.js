/**
 * ticketRoutes.js
 * Clean canonical REST API for QueueLess Ticket operations
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const queueService = require('../services/queueService');
const Ticket = require('../models/Ticket');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// POST /api/v1/tickets - Issue a new Ticket
router.post('/', async (req, res) => {
  try {
    const { organizationId, departmentId, serviceId, priority, source, roomNumber } = req.body;
    const result = await queueService.issueTicket({
      organizationId,
      departmentId,
      serviceId,
      priority,
      source,
      roomNumber
    });
    res.status(201).json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /api/v1/tickets:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// GET /api/v1/tickets/:id - Get Ticket details and dynamic position
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    let ticket = null;

    if (isValidObjectId(id)) {
      ticket = await Ticket.findById(id).populate('currentDepartmentId').populate('organizationId');
    }
    if (!ticket) {
      ticket = await Ticket.findOne({ ticketNumber: id.trim().toUpperCase() })
        .populate('currentDepartmentId')
        .populate('organizationId');
    }

    if (!ticket) {
      return res.status(404).json({ success: false, error: 'Ticket not found' });
    }

    // Derive live position ahead in queue
    let peopleAhead = 0;
    if (['WAITING', 'TRANSFERRED', 'SNOOZED'].includes(ticket.status)) {
      peopleAhead = await Ticket.countDocuments({
        organizationId: ticket.organizationId,
        currentDepartmentId: ticket.currentDepartmentId,
        status: { $in: ['WAITING', 'TRANSFERRED', 'SNOOZED'] },
        createdAt: { $lt: ticket.createdAt }
      });
    }

    res.json({
      success: true,
      ticket,
      peopleAhead,
      position: peopleAhead + 1
    });
  } catch (err) {
    console.error('Error in GET /api/v1/tickets/:id:', err);
    res.status(500).json({ success: false, error: err.message });
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
    const { targetDepartmentId, workerId, counterId } = req.body;
    const result = await queueService.transferTicket({
      ticketId: id,
      targetDepartmentId,
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


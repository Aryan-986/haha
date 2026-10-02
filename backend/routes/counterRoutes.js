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

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// Helper: resolve organizationId from body or query
const getOrgId = (req) => req.body?.organizationId || req.query?.organizationId || null;
const getWorkerId = (req) => req.body?.workerId || req.query?.workerId || null;

// GET /api/v1/counters?organizationId=&departmentId=
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

// POST /api/v1/counters - Create counter
router.post('/', async (req, res) => {
  try {
    const { organizationId, departmentId, counterNumber, name } = req.body;
    if (!organizationId || !departmentId || !counterNumber) {
      return res.status(400).json({ success: false, error: 'organizationId, departmentId, and counterNumber are required' });
    }
    const counter = await counterService.createCounter({ organizationId, departmentId, counterNumber, name });
    res.status(201).json({ success: true, counter });
  } catch (err) {
    console.error('Error in POST /counters:', err);
    res.status(err.status || 400).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/counters/:id - Update counter name/number
router.patch('/:id', async (req, res) => {
  try {
    const { name, counterNumber } = req.body;
    const updates = {};
    if (name) updates.name = name;
    if (counterNumber) updates.counterNumber = Number(counterNumber);

    const counter = await Counter.findByIdAndUpdate(req.params.id, updates, { returnDocument: 'after' });
    if (!counter) return res.status(404).json({ success: false, error: 'Counter not found' });
    res.json({ success: true, counter });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/counters/:id/assign-worker
router.post('/:id/assign-worker', async (req, res) => {
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

// POST /api/v1/counters/:id/unassign-worker
router.post('/:id/unassign-worker', async (req, res) => {
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

// POST /api/v1/counters/:id/activate
router.post('/:id/activate', async (req, res) => {
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

// POST /api/v1/counters/:id/break
router.post('/:id/break', async (req, res) => {
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

// POST /api/v1/counters/:id/resume
router.post('/:id/resume', async (req, res) => {
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

// POST /api/v1/counters/:id/offline
router.post('/:id/offline', async (req, res) => {
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

// POST /api/v1/counters/:id/pause
router.post('/:id/pause', async (req, res) => {
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

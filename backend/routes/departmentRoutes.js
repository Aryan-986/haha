/**
 * departmentRoutes.js
 * Department, Counter, and Supervisor operations — Phase 2
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const queueService = require('../services/queueService');
const counterService = require('../services/counterService');
const Counter = require('../models/Counter');
const Department = require('../models/Department');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /api/v1/departments/:id/queue - Live queue metrics for department
router.get('/:id/queue', async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId } = req.query;
    const metrics = await queueService.getDepartmentQueueMetrics(id, orgId);
    res.json({ success: true, ...metrics });
  } catch (err) {
    console.error('Error in GET /departments/:id/queue:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/departments/:id/live - Supervisor full live view with alerts
router.get('/:id/live', async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId } = req.query;
    const liveView = await queueService.getDepartmentLiveView(id, orgId);
    res.json({ success: true, ...liveView });
  } catch (err) {
    console.error('Error in GET /departments/:id/live:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/departments/:id/call-next - Atomically call next ticket
router.post('/:id/call-next', async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId, counterId, workerId, roomId } = req.body;
    const result = await queueService.callNextTicket({
      departmentId: id,
      organizationId: orgId,
      counterId,
      workerId,
      roomId
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /departments/:id/call-next:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/departments/:id/counters - List counters for department
router.get('/:id/counters', async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId } = req.query;
    if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid department ID' });
    const counters = await counterService.getDepartmentCounters({
      departmentId: id,
      organizationId: orgId && isValidObjectId(orgId) ? orgId : null
    });
    res.json({ success: true, counters });
  } catch (err) {
    console.error('Error in GET /departments/:id/counters:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/departments/:id/counters - Create counter under department
router.post('/:id/counters', async (req, res) => {
  try {
    const { id } = req.params;
    const { counterNumber, name, organizationId } = req.body;
    if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid department ID' });

    const dept = await Department.findById(id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    const counter = await counterService.createCounter({
      organizationId: organizationId || dept.orgId,
      departmentId: id,
      counterNumber: Number(counterNumber) || 1,
      name: name || `Counter ${counterNumber || 1}`
    });

    res.status(201).json({ success: true, counter });
  } catch (err) {
    console.error('Error in POST /departments/:id/counters:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Service = require('../models/Service');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const Organization = require('../models/Organization');

// Helper function to validate MongoDB ObjectIds
const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /api/services (Used by TicketTracker to poll live data)
router.get('/services', async (req, res) => {
  try {
    const services = await Service.find();
    res.json(services);
  } catch (err) {
    console.error('SERVER ERROR in GET /services:', err);
    res.status(500).json({ error: 'Failed to fetch services', details: err.message });
  }
});

// POST /api/worker/service/:id/call-next
router.post('/worker/service/:id/call-next', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid Service ID format' });
    }

    // Fetch existing service to evaluate current bounds
    const existingService = await Service.findById(id);
    if (!existingService) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const nextServingNumber = (existingService.currentlyServingNumber || 100) + 1;
    const nextQueueCount = Math.max(0, existingService.currentQueueCount - 1);

    const updatedService = await Service.findByIdAndUpdate(
      id,
      {
        $set: {
          currentlyServingNumber: nextServingNumber,
          currentQueueCount: nextQueueCount
        }
      },
      { new: true, runValidators: false }
    );

    const ticketNumber = `A-${updatedService.currentlyServingNumber}`;

    res.json({
      message: 'Next ticket called successfully',
      ticketNumber,
      currentlyServingNumber: updatedService.currentlyServingNumber,
      currentQueueCount: updatedService.currentQueueCount,
      activeCounters: updatedService.activeCounters || 26
    });
  } catch (err) {
    console.error('SERVER ERROR in /worker/service/:id/call-next:', err);
    res.status(500).json({ error: 'Failed to call next ticket', details: err.message });
  }
});

// PATCH /api/worker/service/:id/queue
router.patch('/worker/service/:id/queue', async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid Service ID format' });
    }

    const existingService = await Service.findById(id);
    if (!existingService) {
      return res.status(404).json({ error: 'Service not found' });
    }

    let updateQuery = {};

    if (action === 'INCREMENT') {
      updateQuery = { $inc: { currentQueueCount: 1 } };
    } else if (action === 'DECREMENT') {
      const nextQueueCount = Math.max(0, existingService.currentQueueCount - 1);
      const nextServingNumber = (existingService.currentlyServingNumber || 100) + 1;
      
      updateQuery = {
        $set: {
          currentQueueCount: nextQueueCount,
          currentlyServingNumber: nextServingNumber
        }
      };
    } else {
      return res.status(400).json({ error: 'Invalid queue adjustment action' });
    }

    const updatedService = await Service.findByIdAndUpdate(
      id,
      updateQuery,
      { new: true, runValidators: false }
    );

    res.json(updatedService);
  } catch (err) {
    console.error('SERVER ERROR in /queue:', err);
    res.status(500).json({ error: 'Failed to adjust queue', details: err.message });
  }
});

// PATCH /api/worker/service/:id/counters
router.patch('/worker/service/:id/counters', async (req, res) => {
  try {
    const { id } = req.params;
    const { activeCounters } = req.body;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ error: 'Invalid Service ID format' });
    }

    const updatedService = await Service.findByIdAndUpdate(
      id,
      { $set: { activeCounters: Math.max(1, Number(activeCounters) || 1) } },
      { new: true, runValidators: false }
    );

    if (!updatedService) {
      return res.status(404).json({ error: 'Service not found' });
    }

    res.json(updatedService);
  } catch (err) {
    console.error('SERVER ERROR in /counters:', err);
    res.status(500).json({ error: 'Failed to update active counters', details: err.message });
  }
});

// POST /api/kiosk/dispense-token
router.post('/kiosk/dispense-token', async (req, res) => {
  try {
    const { serviceId } = req.body;

    let targetId = serviceId;

    if (!targetId) {
      const defaultService = await Service.findOne();
      if (!defaultService) {
        return res.status(404).json({ error: 'Service not found for dispensing token' });
      }
      targetId = defaultService._id;
    } else if (!isValidObjectId(targetId)) {
      return res.status(400).json({ error: 'Invalid Service ID format' });
    }

    const updatedService = await Service.findByIdAndUpdate(
      targetId,
      { $inc: { currentQueueCount: 1 } },
      { new: true, runValidators: false }
    );

    if (!updatedService) {
      return res.status(404).json({ error: 'Service not found for dispensing token' });
    }

    res.json({
      message: 'Token Dispensed Successfully',
      ticket: { ticketNumber: `A-${100 + updatedService.currentQueueCount}` },
      currentQueueCount: updatedService.currentQueueCount
    });
  } catch (err) {
    console.error('SERVER ERROR in /kiosk/dispense-token:', err);
    res.status(500).json({ error: 'Failed to dispense token', details: err.message });
  }
});

// POST /api/v1/tokens/transfer & POST /api/tokens/transfer
// Transfer ticket to target department, update history, and set status to 'TRANSFERRED'
const transferTokenHandler = async (req, res) => {
  try {
    const { ticketId, targetDeptId, workerId } = req.body;

    if (!ticketId || !isValidObjectId(ticketId)) {
      return res.status(400).json({ error: 'Valid ticketId is required' });
    }

    if (!targetDeptId || !isValidObjectId(targetDeptId)) {
      return res.status(400).json({ error: 'Valid targetDeptId is required' });
    }

    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    if (ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED') {
      return res.status(400).json({ error: `Cannot transfer a ticket that is already ${ticket.status}` });
    }

    const targetDept = await Department.findById(targetDeptId);
    if (!targetDept) {
      return res.status(404).json({ error: 'Target department not found' });
    }

    // Tenant boundary check if ticket has orgId
    if (ticket.orgId && targetDept.orgId && ticket.orgId.toString() !== targetDept.orgId.toString()) {
      return res.status(400).json({ error: 'Cannot transfer ticket across different organizations' });
    }

    // Push new transition to history
    ticket.history.push({
      deptId: targetDept._id,
      timestamp: new Date(),
      servedBy: workerId || 'Staff Transfer'
    });

    // Update current department and status
    ticket.currentDeptId = targetDept._id;
    ticket.status = 'TRANSFERRED';

    // Calculate queue position in the new department
    const pendingInTarget = await Ticket.countDocuments({
      currentDeptId: targetDept._id,
      status: { $in: ['WAITING', 'TRANSFERRED'] }
    });
    ticket.positionInQueue = pendingInTarget + 1;

    await ticket.save();

    const activeCounters = (targetDept.subCounters && targetDept.subCounters.length > 0)
      ? targetDept.subCounters.length
      : 1;
    const avgTime = targetDept.avgServiceTimeMins || 5;
    const estimatedWaitMin = Math.ceil((pendingInTarget * avgTime) / activeCounters);

    res.json({
      success: true,
      message: `Ticket ${ticket.ticketNumber} transferred to ${targetDept.name} successfully`,
      ticket,
      targetDepartment: targetDept,
      positionInQueue: ticket.positionInQueue,
      estimatedWaitMin
    });
  } catch (err) {
    console.error('SERVER ERROR in /tokens/transfer:', err);
    res.status(500).json({ error: 'Failed to transfer ticket', details: err.message });
  }
};

router.post('/v1/tokens/transfer', transferTokenHandler);
router.post('/tokens/transfer', transferTokenHandler);

module.exports = router;
const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const Ticket = require('../models/Ticket');

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
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ error: 'Service not found' });
    }

    // Increment currently serving token
    service.currentlyServingNumber = (service.currentlyServingNumber || 100) + 1;

    // Decrement remaining queue safely
    if (service.currentQueueCount > 0) {
      service.currentQueueCount -= 1;
    }

    await service.save();

    const ticketNumber = `A-${service.currentlyServingNumber}`;

    res.json({
      message: 'Next ticket called successfully',
      ticketNumber,
      currentlyServingNumber: service.currentlyServingNumber,
      currentQueueCount: service.currentQueueCount,
      activeCounters: service.activeCounters || 26
    });
  } catch (err) {
    console.error('SERVER ERROR in /worker/service/:id/call-next:', err);
    res.status(500).json({ error: 'Failed to call next ticket', details: err.message });
  }
});

// PATCH /api/worker/service/:id/queue
router.patch('/worker/service/:id/queue', async (req, res) => {
  try {
    const { action } = req.body;
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    if (action === 'INCREMENT') service.currentQueueCount += 1;
    if (action === 'DECREMENT') {
      if (service.currentQueueCount > 0) service.currentQueueCount -= 1;
      service.currentlyServingNumber = (service.currentlyServingNumber || 100) + 1;
    }

    await service.save();
    res.json(service);
  } catch (err) {
    console.error('SERVER ERROR in /queue:', err);
    res.status(500).json({ error: 'Failed to adjust queue', details: err.message });
  }
});

// PATCH /api/worker/service/:id/counters
router.patch('/worker/service/:id/counters', async (req, res) => {
  try {
    const { activeCounters } = req.body;
    const service = await Service.findByIdAndUpdate(
      req.params.id,
      { activeCounters: Math.max(1, activeCounters) },
      { new: true }
    );
    if (!service) return res.status(404).json({ error: 'Service not found' });

    res.json(service);
  } catch (err) {
    console.error('SERVER ERROR in /counters:', err);
    res.status(500).json({ error: 'Failed to update active counters', details: err.message });
  }
});

// POST /api/kiosk/dispense-token
router.post('/kiosk/dispense-token', async (req, res) => {
  try {
    const { serviceId } = req.body;
    let service = serviceId ? await Service.findById(serviceId) : await Service.findOne();

    if (!service) {
      return res.status(404).json({ error: 'Service not found for dispensing token' });
    }

    service.currentQueueCount += 1;
    await service.save();

    res.json({
      message: 'Token Dispensed Successfully',
      ticket: { ticketNumber: `A-${100 + service.currentQueueCount}` },
      currentQueueCount: service.currentQueueCount
    });
  } catch (err) {
    console.error('SERVER ERROR in /kiosk/dispense-token:', err);
    res.status(500).json({ error: 'Failed to dispense token', details: err.message });
  }
});

module.exports = router;
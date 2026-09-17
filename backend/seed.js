const express = require('express');
const router = express.Router();
const Service = require('../models/Service');

// GET /api/services
router.get('/services', async (req, res) => {
  try {
    let services = await Service.find();

    // Auto-seed default service if database collection is empty
    if (services.length === 0) {
      const defaultService = await Service.create({
        office: 'District Administration Office (DAO), Kathmandu',
        name: 'Citizenship & National ID Application',
        currentQueueCount: 15,
        activeCounters: 3,
        estimatedWaitMin: 45,
        crowdLevel: 'MODERATE CROWD'
      });
      services = [defaultService];
    }

    res.json(services);
  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(500).json({ error: 'Server error fetching services', details: err.message });
  }
});

// GET /api/queue/:serviceId
router.get('/queue/:serviceId', async (req, res) => {
  try {
    const service = await Service.findById(req.params.serviceId);
    if (!service) {
      return res.status(404).json({ message: 'Service not found' });
    }

    res.json({
      currentQueueCount: service.currentQueueCount,
      activeCounters: service.activeCounters,
      estimatedWaitMin: service.currentQueueCount * 3,
      crowdLevel: service.currentQueueCount > 20 ? 'HIGH CROWD' : 'MODERATE CROWD',
      bestTimeWindow: '3:00 PM - 4:00 PM',
      forecast: [
        { hour: '9:00 AM', crowd: 120 },
        { hour: '11:00 AM', crowd: 180 },
        { hour: '1:00 PM', crowd: 150 },
        { hour: '3:00 PM', crowd: 90 },
        { hour: '5:00 PM', crowd: 40 }
      ]
    });
  } catch (err) {
    console.error('Error fetching queue:', err);
    res.status(500).json({ error: 'Server error fetching queue status' });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const QueueRecord = require('../models/QueueRecord');

// Helper import fallbacks to prevent backend crash if utility modules throw errors
let predictionEngine = {};
try {
  predictionEngine = require('../services/predictionEngine');
} catch (e) {
  console.warn('Prediction engine module warning:', e.message);
}

let geminiService = {};
try {
  geminiService = require('../services/geminiService');
} catch (e) {
  console.warn('Gemini service module warning:', e.message);
}

// GET /api/services - Fetch all services (with anti-cache headers & auto-seeding fallback)
router.get('/services', async (req, res) => {
  try {
    // Prevent browser and proxy caching on repetitive GET requests
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let services = await Service.find();

    // Auto-seed default DAO Kathmandu service if collection is empty
    if (!services || services.length === 0) {
      const defaultService = await Service.create({
        office: 'District Administration Office (DAO), Kathmandu',
        name: 'Citizenship & National ID Application',
        currentQueueCount: 367,
        currentlyServingNumber: 100,
        activeCounters: 26,
        avgServiceTimeMin: 3,
        estimatedWaitMin: 16,
        crowdLevel: 'LOW CROWD',
        requiredDocuments: ['Citizenship Certificate', 'Passport Photos', 'Application Form']
      });
      services = [defaultService];
    }

    res.json(services);
  } catch (err) {
    console.error('ERROR in GET /api/services:', err);
    res.status(500).json({ error: 'Failed to fetch services', details: err.message });
  }
});

// POST /api/services/:id/call-next - Call next ticket and advance current serving number
router.post('/services/:id/call-next', async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    // Safely increment serving number and reduce waiting count
    service.currentlyServingNumber = (service.currentlyServingNumber || 100) + 1;
    if (service.currentQueueCount > 0) {
      service.currentQueueCount -= 1;
    }

    await service.save();

    res.json({
      message: 'Next ticket called successfully',
      ticketNumber: `A-${service.currentlyServingNumber}`,
      currentlyServingNumber: service.currentlyServingNumber,
      currentQueueCount: service.currentQueueCount,
      activeCounters: service.activeCounters
    });
  } catch (err) {
    console.error('ERROR in POST /api/services/:id/call-next:', err);
    res.status(500).json({ error: 'Failed to call next ticket', details: err.message });
  }
});

// GET /api/queue/:serviceId - Get live status & forecast
router.get('/queue/:serviceId', async (req, res) => {
  try {
    // Prevent response caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const service = await Service.findById(req.params.serviceId);
    if (!service) return res.status(404).json({ error: 'Service not found' });

    let historicalRecords = [];
    try {
      if (QueueRecord) {
        historicalRecords = await QueueRecord.find({ serviceId: service._id });
      }
    } catch (dbErr) {
      console.warn('QueueRecord lookup skipped:', dbErr.message);
    }

    // Safely calculate wait time with fallback calculation
    const avgTime = service.avgServiceTimeMin || 3;
    const counters = Math.max(1, service.activeCounters || 1);
    const queueCount = service.currentQueueCount || 0;
    const currentlyServing = service.currentlyServingNumber || 100;

    const currentWait = typeof predictionEngine.calculateWaitTime === 'function'
      ? predictionEngine.calculateWaitTime(queueCount, counters, avgTime)
      : Math.round((queueCount * avgTime) / counters);

    // Safely generate forecast with fallback layout
    let forecast = [
      { hour: '9:00 AM', crowd: 120 },
      { hour: '11:00 AM', crowd: 180 },
      { hour: '1:00 PM', crowd: 150 },
      { hour: '3:00 PM', crowd: 90 },
      { hour: '5:00 PM', crowd: 40 }
    ];
    let bestTimeWindow = '3:00 PM - 4:00 PM';

    if (typeof predictionEngine.generateForecast === 'function') {
      try {
        const forecastData = predictionEngine.generateForecast(queueCount, counters, avgTime, historicalRecords);
        if (forecastData?.forecast) forecast = forecastData.forecast;
        if (forecastData?.bestTimeWindow) bestTimeWindow = forecastData.bestTimeWindow;
      } catch (fErr) {
        console.warn('Forecast generator fallback used:', fErr.message);
      }
    }

    const crowdLevel = typeof predictionEngine.getCrowdStatus === 'function'
      ? predictionEngine.getCrowdStatus(currentWait)
      : (queueCount > 20 ? 'HIGH CROWD' : 'LOW CROWD');

    res.json({
      service,
      currentlyServingNumber: currentlyServing,
      currentQueueCount: queueCount,
      activeCounters: counters,
      estimatedWaitMin: currentWait,
      crowdLevel,
      bestTimeWindow,
      forecast
    });
  } catch (err) {
    console.error('ERROR in GET /api/queue/:serviceId:', err);
    res.status(500).json({ error: 'Failed to fetch queue data', details: err.message });
  }
});

// POST /api/analyze - Get Gemini AI recommendation
router.post('/analyze', async (req, res) => {
  try {
    const { serviceId, currentQueue, bestTimeWindow } = req.body;
    const service = await Service.findById(serviceId);

    if (!service) return res.status(404).json({ error: 'Service not found' });

    let advice = "Visit during off-peak hours (3:00 PM - 4:00 PM) to minimize your waiting time.";
    if (typeof geminiService.generateVisitAdvice === 'function') {
      advice = await geminiService.generateVisitAdvice(
        service.name,
        currentQueue ?? service.currentQueueCount,
        bestTimeWindow,
        service.requiredDocuments || []
      );
    }

    res.json({ advice, documents: service.requiredDocuments || [] });
  } catch (err) {
    console.error('ERROR in POST /api/analyze:', err);
    res.status(500).json({ error: 'AI analysis failed', details: err.message });
  }
});

// POST /api/admin/sim-update - Live Simulation Endpoint
router.post('/admin/sim-update', async (req, res) => {
  try {
    const { serviceId, queueChange, activeCountersChange, currentlyServingChange } = req.body;
    
    // Fallback to finding first record if no serviceId provided
    let service = serviceId ? await Service.findById(serviceId) : await Service.findOne();

    if (!service) return res.status(404).json({ error: 'Service not found' });

    if (queueChange !== undefined) {
      service.currentQueueCount = Math.max(0, service.currentQueueCount + queueChange);
    }

    if (activeCountersChange !== undefined) {
      service.activeCounters = Math.max(1, service.activeCounters + activeCountersChange);
    }

    if (currentlyServingChange !== undefined) {
      service.currentlyServingNumber = Math.max(1, (service.currentlyServingNumber || 100) + currentlyServingChange);
    }

    await service.save();
    res.json({ success: true, service });
  } catch (err) {
    console.error('ERROR in POST /admin/sim-update:', err);
    res.status(500).json({ error: 'Simulation update failed', details: err.message });
  }
});

module.exports = router;
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Service = require('../models/Service');
const QueueRecord = require('../models/QueueRecord');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const Organization = require('../models/Organization');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

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

// =======================================================================
// CALL NEXT TICKET HANDLER
// Resolves:
// - POST /api/queue/call-next
// - POST /api/v1/queue/call-next
// - POST /api/v1/tokens/call-next
// - POST /api/services/:id/call-next
// =======================================================================
const callNextHandler = async (req, res) => {
  try {
    const { serviceId, orgId, deptId, departmentId, counterNumber } = req.body;
    const targetDeptId = deptId || departmentId;
    const activeCounter = counterNumber || 1;

    // 1. Check Department-based multi-tenant tickets first
    if (targetDeptId && isValidObjectId(targetDeptId)) {
      const pendingTicket = await Ticket.findOne({
        currentDeptId: targetDeptId,
        status: { $in: ['WAITING', 'TRANSFERRED'] }
      }).sort({ createdAt: 1 });

      if (pendingTicket) {
        pendingTicket.status = 'SERVING';
        pendingTicket.counterNumber = activeCounter;
        pendingTicket.calledAt = new Date();
        await pendingTicket.save();

        return res.status(200).json({
          success: true,
          message: 'Next ticket called successfully',
          ticketNumber: pendingTicket.ticketNumber,
          ticket: pendingTicket,
          counterNumber: activeCounter
        });
      }

      // If no tickets in queue for this department, fall back to department prefix format
      const dept = await Department.findById(targetDeptId);
      const prefix = dept?.prefix ? dept.prefix.toUpperCase() : 'DOC';
      const mockTicketNum = `${prefix}-${Math.floor(100 + Math.random() * 900)}`;

      return res.status(200).json({
        success: true,
        message: 'No pending DB tickets. Issued simulated ticket.',
        ticketNumber: mockTicketNum,
        ticket: {
          ticketNumber: mockTicketNum,
          status: 'SERVING',
          counterNumber: activeCounter,
          calledAt: new Date()
        }
      });
    }

    // 2. Check legacy Service model if serviceId is provided or passed in URL params
    const targetServiceId = req.params.id || serviceId;
    if (targetServiceId) {
      let service = null;
      if (isValidObjectId(targetServiceId)) {
        service = await Service.findById(targetServiceId);
      }

      if (service) {
        service.currentlyServingNumber = (service.currentlyServingNumber || 100) + 1;
        if (service.currentQueueCount > 0) {
          service.currentQueueCount -= 1;
        }
        await service.save();

        const ticketNum = `A-${service.currentlyServingNumber}`;

        return res.status(200).json({
          success: true,
          message: 'Next ticket called successfully',
          ticketNumber: ticketNum,
          currentlyServingNumber: service.currentlyServingNumber,
          currentQueueCount: service.currentQueueCount,
          activeCounters: service.activeCounters,
          ticket: {
            ticketNumber: ticketNum,
            status: 'SERVING',
            counterNumber: activeCounter,
            calledAt: new Date()
          }
        });
      }
    }

    // 3. Global fallback across any WAITING ticket
    const globalTicket = await Ticket.findOne({
      status: { $in: ['WAITING', 'TRANSFERRED'] }
    }).sort({ createdAt: 1 });

    if (globalTicket) {
      globalTicket.status = 'SERVING';
      globalTicket.counterNumber = activeCounter;
      globalTicket.calledAt = new Date();
      await globalTicket.save();

      return res.status(200).json({
        success: true,
        message: 'Next ticket called successfully',
        ticketNumber: globalTicket.ticketNumber,
        ticket: globalTicket,
        counterNumber: activeCounter
      });
    }

    // 4. Default mock fallback ticket to ensure Worker Dashboard UI updates without crashing
    const fallbackNum = `A-${Math.floor(100 + Math.random() * 900)}`;
    return res.status(200).json({
      success: true,
      message: 'No tickets in queue. Generated fallback ticket.',
      ticketNumber: fallbackNum,
      ticket: {
        ticketNumber: fallbackNum,
        status: 'SERVING',
        counterNumber: activeCounter,
        calledAt: new Date()
      }
    });

  } catch (err) {
    console.error('ERROR in callNextHandler:', err);
    return res.status(500).json({ error: 'Failed to call next ticket', details: err.message });
  }
};

// Register Call Next Endpoints across all route aliases
router.post('/call-next', callNextHandler);
router.post('/v1/queue/call-next', callNextHandler);
router.post('/v1/tokens/call-next', callNextHandler);
router.post('/services/:id/call-next', callNextHandler);

// =======================================================================
// GET /api/services - Fetch all services
// =======================================================================
router.get('/services', async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    let services = await Service.find();

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

// =======================================================================
// GET /api/queue/:serviceId - Legacy Get live status & forecast
// =======================================================================
router.get('/queue/:serviceId', async (req, res) => {
  try {
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

    const avgTime = service.avgServiceTimeMin || 3;
    const counters = Math.max(1, service.activeCounters || 1);
    const queueCount = service.currentQueueCount || 0;
    const currentlyServing = service.currentlyServingNumber || 100;

    const currentWait = typeof predictionEngine.calculateWaitTime === 'function'
      ? predictionEngine.calculateWaitTime(queueCount, counters, avgTime)
      : Math.round((queueCount * avgTime) / counters);

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

// =======================================================================
// POST /api/analyze - Get Gemini AI recommendation
// =======================================================================
router.post('/analyze', async (req, res) => {
  try {
    const { serviceId, currentQueue, bestTimeWindow } = req.body;
    let service = null;

    if (serviceId && isValidObjectId(serviceId)) {
      try {
        service = await Service.findById(serviceId);
      } catch (e) {
        // Ignore invalid ObjectId casting errors
      }
    }

    if (!service) {
      service = await Service.findOne();
    }

    const serviceName = service?.name || 'Citizenship & National ID Application';
    const queueCount = currentQueue ?? service?.currentQueueCount ?? 15;
    const window = bestTimeWindow || service?.bestTimeWindow || '3:00 PM - 4:00 PM';
    const documents = (service?.requiredDocuments && service.requiredDocuments.length > 0)
      ? service.requiredDocuments
      : ['Citizenship Certificate', 'Passport Photos', 'Application Form', 'National ID Pre-enrollment Slip'];

    let advice = `Visit during off-peak hours (${window}) to minimize your waiting time.`;
    if (typeof geminiService.generateVisitAdvice === 'function') {
      advice = await geminiService.generateVisitAdvice(
        serviceName,
        queueCount,
        window,
        documents
      );
    }

    res.json({ advice, documents });
  } catch (err) {
    console.error('ERROR in POST /api/analyze:', err);
    res.status(500).json({ error: 'AI analysis failed', details: err.message });
  }
});

// =======================================================================
// POST /api/admin/sim-update - Live Simulation Endpoint
// =======================================================================
router.post('/admin/sim-update', async (req, res) => {
  try {
    const { serviceId, queueChange, activeCountersChange, currentlyServingChange } = req.body;

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

// =======================================================================
// POST /api/v1/tokens/issue & POST /api/tokens/issue
// =======================================================================
const issueTokenHandler = async (req, res) => {
  try {
    const { orgId, deptId, departmentId, organizationId } = req.body;
    const targetOrgId = orgId || organizationId;
    const targetDeptId = deptId || departmentId;

    let targetDept = null;

    if (targetDeptId) {
      if (!isValidObjectId(targetDeptId)) {
        return res.status(400).json({ error: 'Invalid Department ID format' });
      }
      targetDept = await Department.findById(targetDeptId);
      if (!targetDept) {
        return res.status(404).json({ error: 'Specified department not found' });
      }
    } else if (targetOrgId) {
      if (!isValidObjectId(targetOrgId)) {
        return res.status(400).json({ error: 'Invalid Organization ID format' });
      }
      targetDept = await Department.findOne({ orgId: targetOrgId, isEntryLevel: true });
      if (!targetDept) {
        targetDept = await Department.findOne({ orgId: targetOrgId }).sort({ createdAt: 1 });
      }
      if (!targetDept) {
        return res.status(400).json({ error: 'No departments configured for this organization' });
      }
    } else {
      targetDept = await Department.findOne({ isEntryLevel: true });
      if (!targetDept) {
        targetDept = await Department.findOne().sort({ createdAt: 1 });
      }
      if (!targetDept) {
        return res.status(400).json({ error: 'No departments available to issue ticket. Please specify an orgId.' });
      }
    }

    const deptPrefix = (targetDept.prefix || 'T').toUpperCase();
    const count = await Ticket.countDocuments({ currentDeptId: targetDept._id });
    const ticketNumber = `${deptPrefix}-${String(count + 1).padStart(3, '0')}`;

    const pendingCount = await Ticket.countDocuments({
      currentDeptId: targetDept._id,
      status: { $in: ['WAITING', 'TRANSFERRED'] }
    });
    const positionInQueue = pendingCount + 1;

    const newTicket = await Ticket.create({
      ticketNumber,
      orgId: targetDept.orgId,
      currentDeptId: targetDept._id,
      status: 'WAITING',
      positionInQueue,
      history: [
        {
          deptId: targetDept._id,
          timestamp: new Date(),
          servedBy: null
        }
      ]
    });

    const activeCounters = (targetDept.subCounters && targetDept.subCounters.length > 0)
      ? targetDept.subCounters.length
      : 1;
    const avgServiceTime = targetDept.avgServiceTimeMins || 5;
    const estimatedWaitMin = Math.ceil((pendingCount * avgServiceTime) / activeCounters);

    res.status(201).json({
      success: true,
      message: 'Ticket issued successfully',
      ticket: newTicket,
      department: targetDept,
      positionInQueue,
      estimatedWaitMin
    });
  } catch (err) {
    console.error('ERROR in /tokens/issue:', err);
    res.status(500).json({ error: 'Failed to issue token', details: err.message });
  }
};

router.post('/v1/tokens/issue', issueTokenHandler);
router.post('/tokens/issue', issueTokenHandler);

// =======================================================================
// GET /api/v1/tokens/track/:ticketId & GET /api/tokens/track/:ticketId
// =======================================================================
const trackTokenHandler = async (req, res) => {
  try {
    const { ticketId } = req.params;

    const query = isValidObjectId(ticketId)
      ? { _id: ticketId }
      : { ticketNumber: ticketId };

    const ticket = await Ticket.findOne(query)
      .populate('orgId', 'name type address status')
      .populate('currentDeptId', 'name prefix avgServiceTimeMins subCounters isEntryLevel')
      .populate('history.deptId', 'name prefix');

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    let dynamicWaitTime = 0;
    let pendingAhead = 0;
    const currentDept = ticket.currentDeptId;
    const activeSubCounters = (currentDept?.subCounters && currentDept.subCounters.length > 0)
      ? currentDept.subCounters.length
      : 1;
    const avgTime = currentDept?.avgServiceTimeMins || 5;

    if (ticket.status === 'WAITING' || ticket.status === 'TRANSFERRED') {
      pendingAhead = await Ticket.countDocuments({
        currentDeptId: currentDept?._id || currentDept,
        status: { $in: ['WAITING', 'TRANSFERRED'] },
        _id: { $ne: ticket._id },
        updatedAt: { $lt: ticket.updatedAt }
      });

      dynamicWaitTime = Math.ceil((pendingAhead * avgTime) / activeSubCounters);
    }

    res.json({
      success: true,
      ticket: {
        _id: ticket._id,
        ticketNumber: ticket.ticketNumber,
        status: ticket.status,
        positionInQueue: pendingAhead + 1,
        organization: ticket.orgId,
        currentDepartment: ticket.currentDeptId,
        history: ticket.history,
        createdAt: ticket.createdAt,
        updatedAt: ticket.updatedAt
      },
      queueStatus: {
        pendingAhead,
        activeSubCounters,
        avgServiceTimeMins: avgTime,
        dynamicWaitTimeMin: dynamicWaitTime
      }
    });
  } catch (err) {
    console.error('ERROR in /tokens/track:', err);
    res.status(500).json({ error: 'Failed to track token', details: err.message });
  }
};

router.get('/v1/tokens/track/:ticketId', trackTokenHandler);
router.get('/tokens/track/:ticketId', trackTokenHandler);

// =======================================================================
// GET /api/v1/queue/:deptId - Department live queue metrics
// =======================================================================
const deptQueueHandler = async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const { deptId } = req.params;

    if (isValidObjectId(deptId)) {
      const dept = await Department.findById(deptId);

      if (dept) {
        const pendingCount = await Ticket.countDocuments({
          currentDeptId: dept._id,
          status: { $in: ['WAITING', 'TRANSFERRED'] }
        });

        const activeCounters = (dept.subCounters && dept.subCounters.length > 0)
          ? dept.subCounters.length
          : 1;
        const avgTime = dept.avgServiceTimeMins || 5;
        const estimatedWaitMin = Math.ceil((pendingCount * avgTime) / activeCounters);

        const crowdLevel = pendingCount > 30 ? 'HIGH CROWD'
          : pendingCount > 15 ? 'MODERATE CROWD'
            : 'LOW CROWD';

        const forecast = [
          { hour: '9:00 AM', crowd: Math.max(5, pendingCount * 1.2) },
          { hour: '11:00 AM', crowd: Math.max(5, pendingCount * 1.8) },
          { hour: '1:00 PM', crowd: Math.max(5, pendingCount * 1.5) },
          { hour: '3:00 PM', crowd: Math.max(5, pendingCount * 0.9) },
          { hour: '5:00 PM', crowd: Math.max(5, pendingCount * 0.4) }
        ].map(f => ({ ...f, crowd: Math.round(f.crowd) }));

        return res.json({
          department: dept,
          currentQueueCount: pendingCount,
          activeCounters,
          estimatedWaitMin,
          crowdLevel,
          bestTimeWindow: '3:00 PM - 4:00 PM',
          forecast
        });
      }

      const service = await Service.findById(deptId);
      if (service) {
        const avgTime = service.avgServiceTimeMin || 3;
        const counters = Math.max(1, service.activeCounters || 1);
        const queueCount = service.currentQueueCount || 0;
        const estimatedWaitMin = Math.round((queueCount * avgTime) / counters);
        const crowdLevel = queueCount > 20 ? 'HIGH CROWD' : 'LOW CROWD';

        return res.json({
          service,
          currentQueueCount: queueCount,
          activeCounters: counters,
          estimatedWaitMin,
          crowdLevel,
          bestTimeWindow: '3:00 PM - 4:00 PM',
          forecast: [
            { hour: '9:00 AM', crowd: 120 },
            { hour: '11:00 AM', crowd: 180 },
            { hour: '1:00 PM', crowd: 150 },
            { hour: '3:00 PM', crowd: 90 },
            { hour: '5:00 PM', crowd: 40 }
          ]
        });
      }
    }

    return res.status(404).json({ error: 'Department or Service not found for the given ID' });
  } catch (err) {
    console.error('ERROR in GET /api/v1/queue/:deptId:', err);
    res.status(500).json({ error: 'Failed to fetch queue data', details: err.message });
  }
};

router.get('/v1/queue/:deptId', deptQueueHandler);
router.get('/queue/dept/:deptId', deptQueueHandler);

// =======================================================================
// POST /api/v1/tokens/dispense - Kiosk Hardware Simulator endpoint
// =======================================================================
const dispenseTokenHandler = async (req, res) => {
  try {
    const { orgId, deptId, source } = req.body;

    let targetDept = null;

    if (deptId && isValidObjectId(deptId)) {
      targetDept = await Department.findById(deptId);
    } else if (orgId && isValidObjectId(orgId)) {
      targetDept = await Department.findOne({ orgId, isEntryLevel: true });
      if (!targetDept) {
        targetDept = await Department.findOne({ orgId }).sort({ createdAt: 1 });
      }
    }

    if (!targetDept) {
      const { serviceId } = req.body;
      let targetServiceId = serviceId;

      if (!targetServiceId) {
        const defaultService = await Service.findOne();
        if (!defaultService) {
          return res.status(404).json({ error: 'No service or department available for dispensing' });
        }
        targetServiceId = defaultService._id;
      }

      const updatedService = await Service.findByIdAndUpdate(
        targetServiceId,
        { $inc: { currentQueueCount: 1 } },
        { new: true, runValidators: false }
      );

      if (!updatedService) {
        return res.status(404).json({ error: 'Service not found' });
      }

      return res.json({
        success: true,
        source: source || 'KIOSK',
        ticketNumber: `A-${100 + updatedService.currentQueueCount}`,
        ticket: { ticketNumber: `A-${100 + updatedService.currentQueueCount}` },
        currentQueueCount: updatedService.currentQueueCount
      });
    }

    const deptPrefix = (targetDept.prefix || 'T').toUpperCase();
    const count = await Ticket.countDocuments({ currentDeptId: targetDept._id });
    const ticketNumber = `${deptPrefix}-${String(count + 1).padStart(3, '0')}`;

    const pendingCount = await Ticket.countDocuments({
      currentDeptId: targetDept._id,
      status: { $in: ['WAITING', 'TRANSFERRED'] }
    });
    const positionInQueue = pendingCount + 1;

    const newTicket = await Ticket.create({
      ticketNumber,
      orgId: targetDept.orgId,
      currentDeptId: targetDept._id,
      status: 'WAITING',
      positionInQueue,
      history: [{ deptId: targetDept._id, timestamp: new Date(), servedBy: null }]
    });

    const activeCounters = (targetDept.subCounters && targetDept.subCounters.length > 0)
      ? targetDept.subCounters.length : 1;
    const estimatedWaitMin = Math.ceil((pendingCount * (targetDept.avgServiceTimeMins || 5)) / activeCounters);

    res.status(201).json({
      success: true,
      source: source || 'KIOSK',
      ticketNumber: newTicket.ticketNumber,
      ticket: newTicket,
      department: targetDept,
      positionInQueue,
      estimatedWaitMin
    });
  } catch (err) {
    console.error('ERROR in /tokens/dispense:', err);
    res.status(500).json({ error: 'Failed to dispense token', details: err.message });
  }
};

router.post('/v1/tokens/dispense', dispenseTokenHandler);
router.post('/tokens/dispense', dispenseTokenHandler);
router.post('/kiosk/dispense-token', dispenseTokenHandler);

module.exports = router;
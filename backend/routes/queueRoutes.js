const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const rateLimit = require('express-rate-limit');
const Service = require('../models/Service');
const QueueRecord = require('../models/QueueRecord');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const Organization = require('../models/Organization');
const queueService = require('../services/queueService');
const { emitQueueEvent } = require('../socket');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

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
// Canonical, atomic, and scoped to Department / Counter / Room
// Never executes broad updateMany across whole department.
// Never generates fake tickets in real queue flow.
// =======================================================================
const callNextHandler = async (req, res) => {
  try {
    const { serviceId, orgId, deptId, departmentId, counterNumber, counterId, workerId, roomId } = req.body;
    const targetDeptId = deptId || departmentId;

    // 1. Department-based queue operations (Primary / Source of Truth)
    if (targetDeptId && isValidObjectId(targetDeptId)) {
      const result = await queueService.callNextTicket({
        organizationId: orgId,
        departmentId: targetDeptId,
        counterId,
        workerId,
        roomId
      });

      return res.status(200).json({
        success: true,
        message: result.message || (result.ticket ? 'Next ticket called successfully' : 'No waiting tickets in this queue'),
        ticketNumber: result.ticketNumber,
        ticket: result.ticket,
        counterNumber: result.counterNumber || counterNumber || 1,
        roomNumber: result.roomNumber || ''
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Valid departmentId is required to call next ticket'
    });
  } catch (err) {
    console.error('ERROR in callNextHandler:', err);
    return res.status(500).json({ error: 'Failed to call next ticket', details: err.message });
  }
};

// Register Call Next Endpoints across all route aliases (Staff only)
router.post('/call-next', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), callNextHandler);
router.post('/v1/queue/call-next', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), callNextHandler);
router.post('/v1/tokens/call-next', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), callNextHandler);
router.post('/services/:id/call-next', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), callNextHandler);

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
// POST /api/admin/sim-update - Live Simulation Endpoint (Master Admin only; blocked in production)
// =======================================================================
router.post('/admin/sim-update', requireAuth, checkRole(['master_admin']), async (req, res) => {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SIMULATOR) {
    return res.status(403).json({ error: 'Simulator endpoint is disabled in production' });
  }
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
// FIXED: Now uses queueService.issueTicket (atomic, idempotent, correct)
// The previous inline handler used non-atomic Ticket.countDocuments which
// could produce duplicate ticket numbers under concurrent load.
const tokenIssuanceLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.TICKET_RATE_LIMIT ? parseInt(process.env.TICKET_RATE_LIMIT) : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many token requests from this IP. Please wait before requesting another token.'
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test' && process.env.TEST_AUTH_BYPASS === 'true';
  }
});

const issueTokenHandler = async (req, res) => {
  try {
    const {
      orgId,
      deptId,
      departmentId,
      organizationId,
      serviceWorkflowId,
      workflowId,
      serviceId,
      roomNumber,
      idempotencyKey,
      priority,
      source
    } = req.body;
    const targetOrgId = orgId || organizationId;
    const targetDeptId = deptId || departmentId;
    const targetWorkflowId = serviceWorkflowId || workflowId;
    const key = req.headers['idempotency-key'] || idempotencyKey;

    if (!targetOrgId || !mongoose.Types.ObjectId.isValid(targetOrgId)) {
      return res.status(400).json({ success: false, error: 'Valid orgId or organizationId is required' });
    }
    if (!targetDeptId && !targetWorkflowId) {
      return res.status(400).json({ success: false, error: 'Valid deptId, departmentId, or serviceWorkflowId is required' });
    }
    if (targetDeptId && !mongoose.Types.ObjectId.isValid(targetDeptId)) {
      return res.status(400).json({ success: false, error: 'Valid deptId or departmentId is required' });
    }
    if (targetWorkflowId && !mongoose.Types.ObjectId.isValid(targetWorkflowId)) {
      return res.status(400).json({ success: false, error: 'Valid serviceWorkflowId is required' });
    }

    const result = await queueService.issueTicket({
      organizationId: targetOrgId,
      departmentId: targetDeptId,
      serviceWorkflowId: targetWorkflowId,
      serviceId,
      priority: priority || 'NORMAL',
      source: source || 'WEB',
      roomNumber,
      idempotencyKey: key
    });

    res.status(result.isIdempotent ? 200 : 201).json({
      success: true,
      message: result.isIdempotent ? 'Ticket already issued (idempotent)' : 'Ticket issued successfully',
      ticket: result.ticket,
      ticketNumber: result.ticketNumber,
      trackingToken: result.trackingToken,
      positionInQueue: result.position,
      estimatedWaitMin: result.estimatedWaitMin,
      department: result.department
    });
  } catch (err) {
    console.error('ERROR in /tokens/issue:', err);
    res.status(err.status || 500).json({ success: false, error: err.message || 'Failed to issue token' });
  }
};

router.post('/v1/tokens/issue', tokenIssuanceLimit, issueTokenHandler);
router.post('/tokens/issue', tokenIssuanceLimit, issueTokenHandler);

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
      .populate('currentDeptId', 'name prefix avgServiceTimeMins subCounters isEntryLevel roomNumber')
      .populate('targetRoomId', 'name prefix roomNumber')
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
        targetRoom: ticket.targetRoomId,
        roomNumber: ticket.roomNumber,
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
    // 1. Development-only safeguard: reject in production
    if (process.env.NODE_ENV === 'production') {
      return res.status(403).json({
        success: false,
        error: 'Hardware Kiosk Simulator is disabled in production environments'
      });
    }

    const { orgId, deptId, source, priority, roomNumber } = req.body;

    let targetDept = null;
    let targetOrgId = orgId;

    if (deptId && isValidObjectId(deptId)) {
      targetDept = await Department.findById(deptId);
      if (targetDept) targetOrgId = targetDept.orgId;
    } else if (orgId && isValidObjectId(orgId)) {
      targetDept = await Department.findOne({ orgId, isEntryLevel: true });
      if (!targetDept) {
        targetDept = await Department.findOne({ orgId }).sort({ createdAt: 1 });
      }
    }

    if (targetDept && targetOrgId) {
      // 2. Validate organization is active and not archived
      const org = await Organization.findOne({ _id: targetOrgId, isDeleted: { $ne: true } });
      if (!org || org.status === 'INACTIVE') {
        return res.status(400).json({ success: false, error: 'Organization is inactive or archived' });
      }

      // 3. Issue ticket through authoritative queue engine
      const result = await queueService.issueTicket({
        organizationId: targetOrgId,
        departmentId: targetDept._id,
        priority: priority || 'NORMAL',
        source: 'KIOSK',
        roomNumber
      });

      return res.status(201).json({
        success: true,
        source: 'KIOSK',
        isSimulation: true,
        ticketNumber: result.ticketNumber,
        ticket: result.ticket,
        department: result.department,
        positionInQueue: result.position,
        estimatedWaitMin: result.estimatedWaitMin
      });
    }

    return res.status(400).json({
      success: false,
      error: 'Valid organization and department are required for dispensing'
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
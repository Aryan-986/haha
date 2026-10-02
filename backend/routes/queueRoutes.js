const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Service = require('../models/Service');
const QueueRecord = require('../models/QueueRecord');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const Organization = require('../models/Organization');
const queueService = require('../services/queueService');
const { emitQueueEvent } = require('../socket');

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

    // 2. Legacy Service model fallback if serviceId is provided
    const targetServiceId = req.params.id || serviceId;
    if (targetServiceId && isValidObjectId(targetServiceId)) {
      const service = await Service.findById(targetServiceId);
      if (service) {
        service.currentlyServingNumber = (service.currentlyServingNumber || 100) + 1;
        if (service.currentQueueCount > 0) {
          service.currentQueueCount -= 1;
        }
        await service.save();

        const ticketNum = `A-${service.currentlyServingNumber}`;
        const legacyPayload = {
          ticketNumber: ticketNum,
          ticket: {
            ticketNumber: ticketNum,
            status: 'SERVING',
            counterNumber: counterNumber || 1,
            calledAt: new Date()
          },
          event: 'CALL_NEXT_LEGACY'
        };
        emitQueueEvent('TOKEN_CALLED', legacyPayload);
        emitQueueEvent('TOKEN_UPDATED', legacyPayload);

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
            counterNumber: counterNumber || 1,
            calledAt: new Date()
          }
        });
      }
    }

    return res.status(400).json({
      success: false,
      error: 'departmentId or serviceId is required to call next ticket'
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
    const { orgId, deptId, departmentId, organizationId, roomId, roomNumber } = req.body;
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

    // Resolve roomNumber: use explicit param, or inherit from target department
    const resolvedRoomNumber = roomNumber || targetDept.roomNumber || '';

    // Resolve targetRoomId: use explicit roomId param, or if dept has a roomNumber, use dept._id as room ref
    let resolvedRoomId = null;
    if (roomId && isValidObjectId(roomId)) {
      resolvedRoomId = roomId;
    } else if (targetDept.roomNumber) {
      resolvedRoomId = targetDept._id;
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
      targetRoomId: resolvedRoomId,
      roomNumber: resolvedRoomNumber,
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

    // Emit Socket.io event for token issued
    emitQueueEvent('TOKEN_UPDATED', {
      orgId: targetDept.orgId?.toString(),
      deptId: targetDept._id.toString(),
      ticket: newTicket,
      ticketNumber: newTicket.ticketNumber,
      roomNumber: resolvedRoomNumber,
      event: 'ISSUE'
    });

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
      const result = await queueService.issueTicket({
        organizationId: targetOrgId,
        departmentId: targetDept._id,
        priority: priority || 'NORMAL',
        source: source || 'KIOSK',
        roomNumber
      });

      return res.status(201).json({
        success: true,
        source: source || 'KIOSK',
        ticketNumber: result.ticketNumber,
        ticket: result.ticket,
        department: result.department,
        positionInQueue: result.position,
        estimatedWaitMin: result.estimatedWaitMin
      });
    }

    // Fallback for legacy standalone Service if no org/dept exists
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

    const ticketNum = `A-${100 + updatedService.currentQueueCount}`;
    emitQueueEvent('TOKEN_UPDATED', {
      ticketNumber: ticketNum,
      ticket: { ticketNumber: ticketNum },
      event: 'DISPENSE_LEGACY'
    });

    return res.json({
      success: true,
      source: source || 'KIOSK',
      ticketNumber: ticketNum,
      ticket: { ticketNumber: ticketNum },
      currentQueueCount: updatedService.currentQueueCount
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
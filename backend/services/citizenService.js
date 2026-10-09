/**
 * citizenService.js
 * Citizen-facing queue intelligence — Phase 3
 * Provides: position, ETA, journey, events
 * Uses the same ordering as callNextTicket for position accuracy
 */

const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const Counter = require('../models/Counter');
const QueueEvent = require('../models/QueueEvent');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Calculate accurate queue position using the same ordering as callNextTicket.
 * Priority descending (EMERGENCY > URGENT > NORMAL), then createdAt ascending (FIFO).
 * Returns { peopleAhead, position }
 */
async function getTicketPosition(ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  // Terminal statuses — no active position
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(ticket.status)) {
    return { peopleAhead: 0, position: 0, isActive: false, status: ticket.status };
  }

  // If being served or called, they're at the front
  if (['CALLED', 'SERVING'].includes(ticket.status)) {
    return { peopleAhead: 0, position: 0, isActive: true, status: ticket.status };
  }

  // For WAITING, TRANSFERRED, SNOOZED, SKIPPED — count eligible tickets ahead
  // Same filter as callNextTicket: WAITING, TRANSFERRED, or SNOOZED with resumeAt <= now
  const now = new Date();
  const eligibleFilter = {
    organizationId: ticket.organizationId,
    currentDepartmentId: ticket.currentDepartmentId,
    _id: { $ne: ticket._id },
    $or: [
      { status: { $in: ['WAITING', 'TRANSFERRED'] } },
      { status: 'SNOOZED', 'snoozeInfo.resumeAt': { $lte: now } }
    ]
  };

  // Priority mapping for comparison: EMERGENCY=3, URGENT=2, NORMAL=1
  const priorityRank = { EMERGENCY: 3, URGENT: 2, NORMAL: 1 };
  const ticketPriority = priorityRank[ticket.priority] || 1;

  // Tickets ahead are those with:
  // 1. Higher priority, OR
  // 2. Same priority but earlier createdAt
  const higherPriorityCount = await Ticket.countDocuments({
    ...eligibleFilter,
    priority: { $in: Object.keys(priorityRank).filter(p => priorityRank[p] > ticketPriority) }
  });

  const samePriorityEarlierCount = await Ticket.countDocuments({
    ...eligibleFilter,
    priority: ticket.priority,
    createdAt: { $lt: ticket.createdAt }
  });

  const peopleAhead = higherPriorityCount + samePriorityEarlierCount;

  return {
    peopleAhead,
    position: peopleAhead + 1,
    isActive: true,
    status: ticket.status
  };
}

/**
 * Calculate estimated wait time using real queue data.
 * Uses: eligible tickets ahead, avg service duration, active counters, currently serving count
 */
async function getTicketETA(ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  // Terminal or active-service statuses
  if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(ticket.status)) {
    return { estimatedWaitMin: 0, isActive: false, calculable: true };
  }
  if (['CALLED', 'SERVING'].includes(ticket.status)) {
    return { estimatedWaitMin: 0, isActive: true, calculable: true };
  }

  // Get position
  const { peopleAhead } = await getTicketPosition(ticketId);

  // Get department avg service time
  const dept = await Department.findById(ticket.currentDepartmentId);
  const avgServiceTimeMins = dept?.avgServiceTimeMins || 5;

  // Count active counters
  const activeCountersCount = await Counter.countDocuments({
    departmentId: ticket.currentDepartmentId,
    organizationId: ticket.organizationId,
    isActive: true,
    status: { $ne: 'OFFLINE' }
  }) || 1;

  // Count tickets currently being served (SERVING or CALLED)
  const currentlyServingCount = await Counter.countDocuments({
    departmentId: ticket.currentDepartmentId,
    organizationId: ticket.organizationId,
    status: 'BUSY',
    currentTicketId: { $ne: null }
  });

  // Effective available counters = active counters - counters that need to finish current service
  // But we approximate: ETA = (peopleAhead * avgServiceTime) / activeCounters
  // This is the standard M/M/c queue approximation without ML
  const effectiveCounters = Math.max(1, activeCountersCount);
  const estimatedWaitMin = Math.ceil((peopleAhead * avgServiceTimeMins) / effectiveCounters);

  return {
    estimatedWaitMin,
    peopleAhead,
    avgServiceTimeMins,
    activeCounters: activeCountersCount,
    currentlyServing: currentlyServingCount,
    isActive: true,
    calculable: true
  };
}

/**
 * Get the multi-department journey for a ticket.
 * Uses ticket.history[] and populates department names.
 */
async function getTicketJourney(ticketId) {
  const ticket = await Ticket.findById(ticketId)
    .populate('organizationId', 'name type')
    .populate('currentDepartmentId', 'name prefix roomNumber')
    .populate('history.deptId', 'name prefix roomNumber');

  if (!ticket) throw new Error('Ticket not found');

  // Build journey stages from history
  const stages = [];
  const deptStageMap = new Map();

  for (const entry of ticket.history) {
    const deptId = entry.deptId?._id?.toString() || entry.deptId?.toString();
    const deptName = entry.deptId?.name || 'Unknown Department';
    const deptPrefix = entry.deptId?.prefix || '';
    const roomNumber = entry.deptId?.roomNumber || '';

    if (!deptStageMap.has(deptId)) {
      deptStageMap.set(deptId, {
        departmentId: deptId,
        departmentName: deptName,
        departmentPrefix: deptPrefix,
        roomNumber,
        status: 'PENDING',
        arrivedAt: entry.timestamp,
        startedAt: null,
        completedAt: null,
        counter: null,
        actions: []
      });
      stages.push(deptStageMap.get(deptId));
    }

    const stage = deptStageMap.get(deptId);
    stage.actions.push({
      action: entry.action,
      timestamp: entry.timestamp,
      servedBy: entry.servedBy,
      counterId: entry.counterId
    });

    // Update stage status based on action
    if (entry.action === 'ISSUED' || entry.action?.startsWith('TRANSFERRED_FROM')) {
      stage.status = 'ARRIVED';
      stage.arrivedAt = entry.timestamp;
    }
    if (entry.action === 'CALLED') {
      stage.status = 'CALLED';
      if (entry.counterId) stage.counter = entry.counterId;
    }
    if (entry.action === 'SERVICE_STARTED') {
      stage.status = 'SERVING';
      stage.startedAt = entry.timestamp;
    }
    if (entry.action === 'SERVICE_COMPLETED') {
      stage.status = 'COMPLETED';
      stage.completedAt = entry.timestamp;
    }
    if (entry.action?.includes('SNOOZED')) {
      stage.status = 'SNOOZED';
    }
    if (entry.action === 'TICKET_RESUMED') {
      stage.status = 'WAITING';
    }
    if (entry.action === 'SKIPPED') {
      stage.status = 'SKIPPED';
    }
    if (entry.action === 'NO_SHOW') {
      stage.status = 'NO_SHOW';
    }
  }

  // The current department gets the ticket's current status, and prior departments are COMPLETED
  const currentDeptId = ticket.currentDepartmentId?._id?.toString() || ticket.currentDepartmentId?.toString();
  for (const [deptId, stage] of deptStageMap.entries()) {
    if (deptId !== currentDeptId) {
      stage.status = 'COMPLETED';
    }
  }

  if (deptStageMap.has(currentDeptId)) {
    const currentStage = deptStageMap.get(currentDeptId);
    switch (ticket.status) {
      case 'TRANSFERRED':
      case 'WAITING':
        currentStage.status = 'WAITING';
        break;
      case 'CALLED': currentStage.status = 'CALLED'; break;
      case 'SERVING': currentStage.status = 'SERVING'; break;
      case 'SNOOZED': currentStage.status = 'SNOOZED'; break;
      case 'SKIPPED': currentStage.status = 'SKIPPED'; break;
      case 'COMPLETED': currentStage.status = 'COMPLETED'; break;
      case 'NO_SHOW': currentStage.status = 'NO_SHOW'; break;
      case 'CANCELLED': currentStage.status = 'CANCELLED'; break;
    }
  }

  return {
    ticketNumber: ticket.ticketNumber,
    ticketId: ticket._id,
    organizationName: ticket.organizationId?.name || '',
    currentStatus: ticket.status,
    stages
  };
}

/**
 * Get QueueEvent timeline for a ticket (citizen-safe fields only).
 */
async function getTicketEvents(ticketId) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');

  const events = await QueueEvent.find({ ticketId })
    .populate('departmentId', 'name prefix roomNumber')
    .sort({ timestamp: 1 });

  // Return citizen-safe event data (no workerId, no internal IDs)
  return events.map(ev => ({
    eventType: ev.eventType,
    departmentName: ev.departmentId?.name || '',
    departmentPrefix: ev.departmentId?.prefix || '',
    timestamp: ev.timestamp,
    metadata: {
      // Only safe fields
      counterNumber: ev.metadata?.counterNumber,
      targetDepartmentName: ev.metadata?.targetDepartmentName,
      minutes: ev.metadata?.minutes,
      source: ev.metadata?.source,
      ticketNumber: ev.metadata?.ticketNumber,
      priority: ev.metadata?.priority
    }
  }));
}

/**
 * Retrieve a ticket by tracking token (for anonymous secure access).
 * Returns safe public fields only.
 */
async function getTicketByTrackingToken(trackingToken) {
  if (!trackingToken || typeof trackingToken !== 'string') {
    throw new Error('Valid tracking token is required');
  }

  const ticket = await Ticket.findOne({ trackingToken })
    .populate('organizationId', 'name type address')
    .populate('currentDepartmentId', 'name prefix roomNumber avgServiceTimeMins')
    .populate('currentCounterId', 'counterNumber name');

  if (!ticket) {
    const err = new Error('Ticket not found');
    err.status = 404;
    throw err;
  }

  return ticket;
}

module.exports = {
  getTicketPosition,
  getTicketETA,
  getTicketJourney,
  getTicketEvents,
  getTicketByTrackingToken
};

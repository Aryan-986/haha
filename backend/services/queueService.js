/**
 * queueService.js
 * Core Queue Engine for QueueLess
 * Enforces Ticket as the source of truth, atomic claiming, safe numbering, and tenant isolation.
 */

const mongoose = require('mongoose');
const Ticket = require('../models/Ticket');
const Department = require('../models/Department');
const Organization = require('../models/Organization');
const Counter = require('../models/Counter');
const Worker = require('../models/Worker');
const QueueEvent = require('../models/QueueEvent');
const TicketSequence = require('../models/TicketSequence');
const { assertValidTransition } = require('./ticketStateMachine');
const { emitQueueEvent } = require('../socket');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Atomically generates sequential ticket number for department on current date.
 * Thread-safe: uses MongoDB findOneAndUpdate with $inc
 */
async function generateAtomicTicketNumber(organizationId, departmentId, prefix) {
  const cleanPrefix = (prefix || 'T').toUpperCase().trim();
  const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const sequenceDoc = await TicketSequence.findOneAndUpdate(
    { organizationId, departmentId, dateStr },
    { $inc: { seq: 1 }, $setOnInsert: { prefix: cleanPrefix } },
    { upsert: true, returnDocument: 'after' }
  );

  return `${cleanPrefix}-${String(sequenceDoc.seq).padStart(3, '0')}`;
}

/**
 * Issue a new Ticket into a Department queue
 */
async function issueTicket({ organizationId, departmentId, serviceId, priority = 'NORMAL', source = 'KIOSK', roomNumber, idempotencyKey }) {
  if (!isValidObjectId(organizationId)) {
    throw new Error('Valid organizationId is required');
  }
  if (!isValidObjectId(departmentId)) {
    throw new Error('Valid departmentId is required');
  }

  // Verify Organization is active and not archived/deleted
  const org = await Organization.findOne({ _id: organizationId, isDeleted: { $ne: true } });
  if (!org || org.status === 'INACTIVE') {
    throw new Error('Organization not found or is archived/inactive');
  }

  // Idempotency: Return existing ticket if duplicate request with same idempotencyKey
  if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim()) {
    const existingTicket = await Ticket.findOne({ idempotencyKey: idempotencyKey.trim() })
      .populate('currentDepartmentId')
      .populate('organizationId');
    if (existingTicket) {
      return {
        ticket: existingTicket,
        ticketNumber: existingTicket.ticketNumber,
        trackingToken: existingTicket.trackingToken,
        position: existingTicket.position,
        estimatedWaitMin: 0,
        department: existingTicket.currentDepartmentId,
        isIdempotent: true
      };
    }
  }

  const dept = await Department.findOne({ _id: departmentId, orgId: organizationId });
  if (!dept) {
    throw new Error('Department not found in specified organization');
  }

  const ticketNumber = await generateAtomicTicketNumber(organizationId, departmentId, dept.prefix);

  const waitingCount = await Ticket.countDocuments({
    organizationId,
    currentDepartmentId: departmentId,
    status: { $in: ['WAITING', 'TRANSFERRED', 'SNOOZED'] }
  });

  const position = waitingCount + 1;
  const resolvedRoomNumber = roomNumber || dept.roomNumber || '';
  const resolvedTargetRoomId = dept.roomNumber ? dept._id : null;

  const normalizedPriority = ['NORMAL', 'URGENT', 'EMERGENCY'].includes(priority) ? priority : 'NORMAL';
  const priorityWeight = normalizedPriority === 'EMERGENCY' ? 3 : normalizedPriority === 'URGENT' ? 2 : 1;

  const ticket = await Ticket.create({
    ticketNumber,
    organizationId,
    currentDepartmentId: departmentId,
    currentServiceId: serviceId && isValidObjectId(serviceId) ? serviceId : null,
    targetRoomId: resolvedTargetRoomId,
    roomNumber: resolvedRoomNumber,
    priority: normalizedPriority,
    priorityWeight,
    source: ['KIOSK', 'WEB', 'MOBILE', 'WALK_IN'].includes(source) ? source : 'WEB',
    idempotencyKey: idempotencyKey ? idempotencyKey.trim() : undefined,
    status: 'WAITING',
    position,
    history: [{
      deptId: departmentId,
      timestamp: new Date(),
      servedBy: source,
      action: 'ISSUED'
    }]
  });

  // Record immutable QueueEvent
  await QueueEvent.create({
    organizationId,
    ticketId: ticket._id,
    departmentId,
    eventType: 'TICKET_CREATED',
    metadata: { source, priority: normalizedPriority, ticketNumber }
  });

  // Calculate live ETA
  const activeCountersCount = await Counter.countDocuments({
    departmentId,
    isActive: true,
    status: { $ne: 'OFFLINE' }
  }) || 1;
  const estimatedWaitMin = Math.ceil((waitingCount * (dept.avgServiceTimeMins || 5)) / Math.max(1, activeCountersCount));

  // Emit standardized real-time socket events
  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    trackingToken: ticket.trackingToken,
    orgId: organizationId.toString(),
    deptId: departmentId.toString(),
    departmentName: dept.name,
    roomNumber: resolvedRoomNumber,
    position,
    estimatedWaitMin,
    event: 'ticket.created'
  };

  emitQueueEvent('ticket.created', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload); // Backward-compatibility event

  return {
    ticket,
    ticketNumber: ticket.ticketNumber,
    trackingToken: ticket.trackingToken,
    position,
    estimatedWaitMin,
    department: dept
  };
}

/**
 * Atomically claims the next eligible ticket for a specific Worker + Counter in Department.
 * Prevents race conditions and prevents destroying other workers' active tickets.
 */
async function callNextTicket({ organizationId, departmentId, counterId, workerId, roomId }) {
  if (!isValidObjectId(departmentId)) {
    throw new Error('Valid departmentId is required');
  }

  const dept = await Department.findById(departmentId);
  if (!dept) {
    throw new Error('Department not found');
  }
  const orgId = organizationId || dept.orgId;

  // Resolve or auto-register counter if counterId provided or fallback
  let counter = null;
  if (counterId && isValidObjectId(counterId)) {
    counter = await Counter.findOne({ _id: counterId, departmentId });
  }

  // Complete any ticket currently actively served ONLY at THIS specific counter/worker
  if (counter && counter.currentTicketId) {
    await Ticket.updateOne(
      { _id: counter.currentTicketId, status: { $in: ['SERVING', 'CALLED'] } },
      { $set: { status: 'COMPLETED', completedAt: new Date() } }
    );
    counter.currentTicketId = null;
  }

  // Build atomic search filter strictly scoped to organization & department
  // Snoozed tickets only re-enter when resumeAt has passed
  const pendingFilter = {
    organizationId: orgId,
    currentDepartmentId: departmentId,
    $or: [
      { status: { $in: ['WAITING', 'TRANSFERRED'] } },
      { status: 'SNOOZED', 'snoozeInfo.resumeAt': { $lte: new Date() } }
    ]
  };

  if (roomId && isValidObjectId(roomId)) {
    pendingFilter.targetRoomId = roomId;
  }

  // Atomic claim using findOneAndUpdate with sort (Priority then FIFO)
  const claimedTicket = await Ticket.findOneAndUpdate(
    pendingFilter,
    {
      $set: {
        status: 'CALLED',
        calledAt: new Date(),
        currentCounterId: counter?._id || null,
        currentWorkerId: workerId && isValidObjectId(workerId) ? workerId : null,
        counterNumber: counter?.counterNumber || 1
      },
      $push: {
        history: {
          deptId: departmentId,
          timestamp: new Date(),
          servedBy: workerId ? workerId.toString() : 'Counter Staff',
          counterId: counter?._id || null,
          action: 'CALLED'
        }
      }
    },
    {
      sort: { priorityWeight: -1, createdAt: 1 },
      returnDocument: 'after'
    }
  );

  // If queue is empty, return null ticket. NO FAKE TICKETS IN REAL QUEUE.
  if (!claimedTicket) {
    if (counter) {
      counter.status = 'AVAILABLE';
      await counter.save();
    }

    const emptyPayload = {
      orgId: orgId.toString(),
      deptId: departmentId.toString(),
      ticket: null,
      ticketNumber: null,
      message: 'Queue is empty'
    };
    emitQueueEvent('queue.updated', emptyPayload);

    return {
      success: true,
      ticket: null,
      ticketNumber: null,
      message: 'No waiting tickets in this queue'
    };
  }

  // Update counter status
  if (counter) {
    counter.status = 'BUSY';
    counter.currentTicketId = claimedTicket._id;
    if (workerId && isValidObjectId(workerId)) {
      counter.assignedWorkerId = workerId;
    }
    await counter.save();
  }

  // Record QueueEvent
  await QueueEvent.create({
    organizationId: orgId,
    ticketId: claimedTicket._id,
    departmentId,
    counterId: counter?._id || null,
    workerId: workerId && isValidObjectId(workerId) ? workerId : null,
    eventType: 'TICKET_CALLED',
    metadata: { counterNumber: counter?.counterNumber || 1 }
  });

  const eventPayload = {
    ticket: claimedTicket,
    ticketNumber: claimedTicket.ticketNumber,
    orgId: orgId.toString(),
    deptId: departmentId.toString(),
    counterNumber: counter?.counterNumber || claimedTicket.counterNumber || 1,
    roomNumber: claimedTicket.roomNumber || dept.roomNumber || '',
    event: 'ticket.called'
  };

  emitQueueEvent('ticket.called', eventPayload);
  emitQueueEvent('queue.updated', eventPayload);
  emitQueueEvent('TOKEN_CALLED', eventPayload); // Backward compatibility
  emitQueueEvent('TOKEN_UPDATED', eventPayload);

  return {
    success: true,
    ticket: claimedTicket,
    ticketNumber: claimedTicket.ticketNumber,
    counterNumber: eventPayload.counterNumber,
    roomNumber: eventPayload.roomNumber
  };
}

/**
 * Start service on a called ticket (CALLED -> SERVING)
 */
async function startService({ ticketId, workerId, counterId }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  assertValidTransition(ticket.status, 'SERVING');

  ticket.status = 'SERVING';
  ticket.serviceStartedAt = new Date();
  if (counterId && isValidObjectId(counterId)) ticket.currentCounterId = counterId;
  if (workerId && isValidObjectId(workerId)) ticket.currentWorkerId = workerId;

  ticket.history.push({
    deptId: ticket.currentDepartmentId,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : 'Staff',
    counterId: counterId || null,
    action: 'SERVICE_STARTED'
  });

  await ticket.save();

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: ticket.currentDepartmentId,
    counterId: counterId || ticket.currentCounterId,
    workerId: workerId || ticket.currentWorkerId,
    eventType: 'SERVICE_STARTED'
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    deptId: ticket.currentDepartmentId.toString(),
    event: 'ticket.started'
  };

  emitQueueEvent('ticket.started', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return ticket;
}

/**
 * Complete service on a ticket (SERVING/CALLED -> COMPLETED)
 */
async function completeService({ ticketId, workerId, counterId }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  assertValidTransition(ticket.status, 'COMPLETED');

  ticket.status = 'COMPLETED';
  ticket.completedAt = new Date();

  ticket.history.push({
    deptId: ticket.currentDepartmentId,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : 'Staff',
    counterId: counterId || null,
    action: 'SERVICE_COMPLETED'
  });

  await ticket.save();

  // Free up counter if assigned
  if (ticket.currentCounterId) {
    await Counter.findByIdAndUpdate(ticket.currentCounterId, {
      status: 'AVAILABLE',
      currentTicketId: null
    });
  }

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: ticket.currentDepartmentId,
    counterId: counterId || ticket.currentCounterId,
    workerId: workerId || ticket.currentWorkerId,
    eventType: 'SERVICE_COMPLETED'
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    deptId: ticket.currentDepartmentId.toString(),
    event: 'ticket.completed'
  };

  emitQueueEvent('ticket.completed', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return ticket;
}

/**
 * Transfer a ticket to a downstream Department
 */
async function transferTicket({ ticketId, targetDepartmentId, workerId, counterId }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');
  if (!isValidObjectId(targetDepartmentId)) throw new Error('Valid targetDepartmentId is required');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  const targetDept = await Department.findById(targetDepartmentId);
  if (!targetDept) throw new Error('Target department not found');

  // Enforce Tenant Boundary: Ticket and target Department must share organizationId
  if (ticket.organizationId.toString() !== targetDept.orgId.toString()) {
    throw new Error('Tenant Boundary Error: Cannot transfer ticket across different organizations');
  }

  assertValidTransition(ticket.status, 'TRANSFERRED');

  const fromDeptId = ticket.currentDepartmentId;

  ticket.status = 'TRANSFERRED';
  ticket.currentDepartmentId = targetDept._id;
  ticket.targetRoomId = targetDept.roomNumber ? targetDept._id : null;
  ticket.roomNumber = targetDept.roomNumber || '';
  ticket.currentCounterId = null;
  ticket.currentWorkerId = null;

  const targetWaitingCount = await Ticket.countDocuments({
    organizationId: ticket.organizationId,
    currentDepartmentId: targetDept._id,
    status: { $in: ['WAITING', 'TRANSFERRED', 'SNOOZED'] }
  });
  ticket.position = targetWaitingCount + 1;

  ticket.transferInfo = {
    fromDepartmentId: fromDeptId,
    toDepartmentId: targetDept._id,
    transferredBy: workerId ? workerId.toString() : 'Staff Transfer',
    transferredAt: new Date()
  };

  ticket.history.push({
    deptId: targetDept._id,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : 'Staff Transfer',
    counterId: counterId || null,
    action: `TRANSFERRED_FROM_${fromDeptId}`
  });

  await ticket.save();

  // Free up origin counter if previously held
  if (counterId && isValidObjectId(counterId)) {
    await Counter.findByIdAndUpdate(counterId, {
      status: 'AVAILABLE',
      currentTicketId: null
    });
  }

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: targetDept._id,
    counterId: counterId || null,
    workerId: workerId && isValidObjectId(workerId) ? workerId : null,
    eventType: 'TICKET_TRANSFERRED',
    metadata: {
      fromDepartmentId: fromDeptId,
      toDepartmentId: targetDept._id,
      targetDepartmentName: targetDept.name
    }
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    fromDeptId: fromDeptId.toString(),
    deptId: targetDept._id.toString(),
    targetDeptId: targetDept._id.toString(),
    targetDeptName: targetDept.name,
    roomNumber: targetDept.roomNumber || '',
    event: 'ticket.transferred'
  };

  emitQueueEvent('ticket.transferred', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return {
    ticket,
    targetDepartment: targetDept,
    positionInQueue: ticket.position
  };
}

/**
 * Snooze a ticket (Citizen or Worker delay request)
 */
async function snoozeTicket({ ticketId, minutes = 5, workerId, source = 'WORKER' }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');
  const validMinutes = [1, 3, 5, 10, 15, 20, 30];

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  assertValidTransition(ticket.status, 'SNOOZED');

  const resumeAt = new Date(Date.now() + minutes * 60 * 1000);
  const fromCounterId = ticket.currentCounterId;

  ticket.status = 'SNOOZED';
  ticket.snoozeInfo = {
    snoozedAt: new Date(),
    snoozeCount: (ticket.snoozeInfo?.snoozeCount || 0) + 1,
    resumePosition: (ticket.position || 1) + Math.ceil(minutes / 2),
    resumeAt,
    source
  };
  // Free the counter
  ticket.currentCounterId = null;
  ticket.currentWorkerId = null;

  ticket.history.push({
    deptId: ticket.currentDepartmentId,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : source,
    action: `SNOOZED_${minutes}_MIN`
  });

  await ticket.save();

  if (fromCounterId) {
    await Counter.findByIdAndUpdate(fromCounterId, {
      status: 'AVAILABLE',
      currentTicketId: null
    });
  }

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: ticket.currentDepartmentId,
    workerId: workerId && isValidObjectId(workerId) ? workerId : null,
    counterId: fromCounterId || null,
    eventType: 'TICKET_SNOOZED',
    metadata: { minutes, snoozeCount: ticket.snoozeInfo.snoozeCount, resumeAt, source }
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    deptId: ticket.currentDepartmentId.toString(),
    resumeAt,
    event: 'ticket.snoozed'
  };

  emitQueueEvent('ticket.snoozed', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return ticket;
}

/**
 * Resume a snoozed ticket back into WAITING status
 */
async function resumeTicket({ ticketId, workerId }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');
  if (ticket.status !== 'SNOOZED') {
    throw new Error(`Cannot resume ticket with status: ${ticket.status}`);
  }

  ticket.status = 'WAITING';
  ticket.snoozeInfo.resumeAt = new Date(); // Mark as resolved
  ticket.currentCounterId = null;
  ticket.currentWorkerId = null;

  ticket.history.push({
    deptId: ticket.currentDepartmentId,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : 'SYSTEM',
    action: 'TICKET_RESUMED'
  });

  await ticket.save();

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: ticket.currentDepartmentId,
    workerId: workerId && isValidObjectId(workerId) ? workerId : null,
    eventType: 'TICKET_RESUMED',
    metadata: { snoozeCount: ticket.snoozeInfo?.snoozeCount || 0 }
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    deptId: ticket.currentDepartmentId.toString(),
    event: 'ticket.resumed'
  };

  emitQueueEvent('ticket.resumed', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return ticket;
}

/**
 * Recall a ticket — re-announce a CALLED ticket (e.g. citizen didn't hear/respond)
 */
async function recallTicket({ ticketId, workerId, counterId }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  if (ticket.status !== 'CALLED') {
    throw new Error(`Cannot recall ticket with status: ${ticket.status}. Ticket must be CALLED.`);
  }

  // Update calledAt to now (re-announce timestamp)
  ticket.calledAt = new Date();
  ticket.history.push({
    deptId: ticket.currentDepartmentId,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : 'Counter Staff',
    counterId: counterId || ticket.currentCounterId,
    action: 'TICKET_RECALLED'
  });

  await ticket.save();

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: ticket.currentDepartmentId,
    counterId: counterId || ticket.currentCounterId,
    workerId: workerId && isValidObjectId(workerId) ? workerId : null,
    eventType: 'TICKET_RECALLED',
    metadata: { recalledAt: ticket.calledAt }
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    deptId: ticket.currentDepartmentId.toString(),
    counterNumber: ticket.counterNumber,
    roomNumber: ticket.roomNumber,
    event: 'ticket.recalled'
  };

  emitQueueEvent('ticket.recalled', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_CALLED', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return ticket;
}

/**
 * Skip a ticket (e.g. citizen temporarily not present at counter)
 */
async function skipTicket({ ticketId, workerId, counterId }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  assertValidTransition(ticket.status, 'SKIPPED');

  ticket.status = 'SKIPPED';
  ticket.history.push({
    deptId: ticket.currentDepartmentId,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : 'Counter Staff',
    counterId: counterId || null,
    action: 'SKIPPED'
  });

  await ticket.save();

  if (ticket.currentCounterId) {
    await Counter.findByIdAndUpdate(ticket.currentCounterId, {
      status: 'AVAILABLE',
      currentTicketId: null
    });
  }

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: ticket.currentDepartmentId,
    counterId: counterId || null,
    workerId: workerId && isValidObjectId(workerId) ? workerId : null,
    eventType: 'TICKET_SKIPPED'
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    deptId: ticket.currentDepartmentId.toString(),
    event: 'ticket.skipped'
  };

  emitQueueEvent('ticket.skipped', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return ticket;
}

/**
 * Mark a ticket as NO_SHOW
 */
async function noShowTicket({ ticketId, workerId, counterId }) {
  if (!isValidObjectId(ticketId)) throw new Error('Valid ticketId is required');

  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new Error('Ticket not found');

  assertValidTransition(ticket.status, 'NO_SHOW');

  ticket.status = 'NO_SHOW';
  ticket.history.push({
    deptId: ticket.currentDepartmentId,
    timestamp: new Date(),
    servedBy: workerId ? workerId.toString() : 'Counter Staff',
    counterId: counterId || null,
    action: 'NO_SHOW'
  });

  await ticket.save();

  if (ticket.currentCounterId) {
    await Counter.findByIdAndUpdate(ticket.currentCounterId, {
      status: 'AVAILABLE',
      currentTicketId: null
    });
  }

  await QueueEvent.create({
    organizationId: ticket.organizationId,
    ticketId: ticket._id,
    departmentId: ticket.currentDepartmentId,
    counterId: counterId || null,
    workerId: workerId && isValidObjectId(workerId) ? workerId : null,
    eventType: 'TICKET_NO_SHOW'
  });

  const payload = {
    ticket,
    ticketNumber: ticket.ticketNumber,
    orgId: ticket.organizationId.toString(),
    deptId: ticket.currentDepartmentId.toString(),
    event: 'ticket.no_show'
  };

  emitQueueEvent('ticket.no_show', payload);
  emitQueueEvent('queue.updated', payload);
  emitQueueEvent('TOKEN_UPDATED', payload);

  return ticket;
}

/**
 * Get accurate, derived live queue metrics for a Department
 * Source of truth is the Ticket collection.
 */
async function getDepartmentQueueMetrics(departmentId, organizationId) {
  if (!isValidObjectId(departmentId)) throw new Error('Valid departmentId is required');

  const dept = await Department.findById(departmentId);
  if (!dept) throw new Error('Department not found');

  const orgId = organizationId || dept.orgId;

  const now = new Date();
  // Active tickets waiting — exclude snoozed tickets that haven't reached resumeAt
  const waitingTickets = await Ticket.find({
    organizationId: orgId,
    currentDepartmentId: departmentId,
    $or: [
      { status: { $in: ['WAITING', 'TRANSFERRED'] } },
      { status: 'SNOOZED', 'snoozeInfo.resumeAt': { $lte: now } }
    ]
  }).sort({ priority: -1, createdAt: 1 });

  // Currently serving ticket
  const servingTicket = await Ticket.findOne({
    organizationId: orgId,
    currentDepartmentId: departmentId,
    status: { $in: ['SERVING', 'CALLED'] }
  }).sort({ calledAt: -1 });

  // Active counters
  const activeCountersCount = await Counter.countDocuments({
    departmentId,
    isActive: true,
    status: { $ne: 'OFFLINE' }
  }) || 1;

  const currentQueueCount = waitingTickets.length;
  const avgTime = dept.avgServiceTimeMins || 5;
  const estimatedWaitMin = Math.ceil((currentQueueCount * avgTime) / activeCountersCount);

  let crowdLevel = 'LOW CROWD';
  if (currentQueueCount > 15) crowdLevel = 'HIGH CROWD';
  else if (currentQueueCount > 5) crowdLevel = 'MODERATE CROWD';

  return {
    department: dept,
    currentQueueCount,
    estimatedWaitMin,
    crowdLevel,
    activeCounters: activeCountersCount,
    servingTicket,
    waitingTickets
  };
}

/**
 * Get live supervisor view of a department (all ticket statuses + counters)
 */
async function getDepartmentLiveView(departmentId, organizationId) {
  if (!isValidObjectId(departmentId)) throw new Error('Valid departmentId is required');

  const dept = await Department.findById(departmentId);
  if (!dept) throw new Error('Department not found');

  const orgId = organizationId || dept.orgId;
  const now = new Date();

  const [waiting, called, serving, completed, skipped, noShow, transferred, snoozed, counters] =
    await Promise.all([
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'WAITING' })
        .sort({ priority: -1, createdAt: 1 }).limit(50),
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'CALLED' })
        .sort({ calledAt: -1 }),
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'SERVING' })
        .sort({ serviceStartedAt: -1 }),
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'COMPLETED' })
        .sort({ completedAt: -1 }).limit(20),
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'SKIPPED' })
        .sort({ updatedAt: -1 }).limit(20),
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'NO_SHOW' })
        .sort({ updatedAt: -1 }).limit(20),
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'TRANSFERRED' })
        .sort({ updatedAt: -1 }).limit(20),
      Ticket.find({ organizationId: orgId, currentDepartmentId: departmentId, status: 'SNOOZED' })
        .sort({ 'snoozeInfo.resumeAt': 1 }),
      Counter.find({ departmentId, organizationId: orgId })
        .populate('assignedWorkerId', 'name role status')
        .populate('currentTicketId', 'ticketNumber status priority calledAt serviceStartedAt')
        .sort({ counterNumber: 1 })
    ]);

  const activeCountersCount = counters.filter(c => c.isActive && c.status !== 'OFFLINE').length || 1;
  const avgTime = dept.avgServiceTimeMins || 5;
  const estimatedWaitMin = Math.ceil((waiting.length * avgTime) / activeCountersCount);

  // Supervisor alerts based on thresholds
  const alerts = [];
  if (waiting.length > 15) alerts.push({ type: 'HIGH_QUEUE', message: `${waiting.length} tickets waiting — high queue depth` });
  const longWait = waiting.find(t => (now - new Date(t.createdAt)) > 30 * 60 * 1000);
  if (longWait) alerts.push({ type: 'LONG_WAIT', message: `Ticket ${longWait.ticketNumber} has waited over 30 minutes` });
  const offlineCounters = counters.filter(c => c.status === 'OFFLINE');
  if (offlineCounters.length > 0) alerts.push({ type: 'COUNTERS_OFFLINE', message: `${offlineCounters.length} counter(s) offline` });
  const breakCounters = counters.filter(c => c.status === 'PAUSED');
  if (breakCounters.length > 0) alerts.push({ type: 'COUNTERS_ON_BREAK', message: `${breakCounters.length} counter(s) on break` });
  serving.forEach(t => {
    const serviceDuration = (now - new Date(t.serviceStartedAt)) / 60000;
    if (serviceDuration > (avgTime * 3)) {
      alerts.push({ type: 'LONG_SERVICE', message: `Ticket ${t.ticketNumber} in service for ${Math.round(serviceDuration)} min` });
    }
  });

  return {
    department: dept,
    stats: {
      waiting: waiting.length,
      called: called.length,
      serving: serving.length,
      completed: completed.length,
      skipped: skipped.length,
      noShow: noShow.length,
      transferred: transferred.length,
      snoozed: snoozed.length,
      estimatedWaitMin,
      activeCounters: activeCountersCount
    },
    tickets: { waiting, called, serving, completed, skipped, noShow, transferred, snoozed },
    counters,
    alerts
  };
}

module.exports = {
  generateAtomicTicketNumber,
  issueTicket,
  callNextTicket,
  startService,
  completeService,
  transferTicket,
  snoozeTicket,
  resumeTicket,
  skipTicket,
  noShowTicket,
  recallTicket,
  getDepartmentQueueMetrics,
  getDepartmentLiveView
};

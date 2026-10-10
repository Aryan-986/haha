/**
 * counterService.js
 * Counter operational management — Phase 2
 */

const mongoose = require('mongoose');
const Counter = require('../models/Counter');
const Worker = require('../models/Worker');
const Ticket = require('../models/Ticket');
const QueueEvent = require('../models/QueueEvent');
const { emitQueueEvent } = require('../socket');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

const Organization = require('../models/Organization');
const Department = require('../models/Department');

/**
 * Create a new counter in a department
 */
async function createCounter({ organizationId, departmentId, counterNumber, name, roomNumber }) {
  if (!isValidObjectId(organizationId)) throw new Error('Valid organizationId is required');
  if (!isValidObjectId(departmentId)) throw new Error('Valid departmentId is required');
  if (!counterNumber) throw new Error('counterNumber is required');

  const org = await Organization.findOne({ _id: organizationId, isDeleted: { $ne: true } });
  if (!org) {
    const err = new Error('Organization not found or is archived');
    err.status = 404;
    throw err;
  }

  const dept = await Department.findOne({ _id: departmentId, orgId: organizationId });
  if (!dept) {
    const err = new Error('Department not found or does not belong to the specified organization');
    err.status = 404;
    throw err;
  }

  const existing = await Counter.findOne({ departmentId, counterNumber: Number(counterNumber) });
  if (existing) {
    const err = new Error(`Counter ${counterNumber} already exists in this department`);
    err.status = 400;
    throw err;
  }

  const resolvedRoom = roomNumber ? String(roomNumber).trim() : (dept.roomNumber || '');

  const counter = await Counter.create({
    organizationId,
    departmentId,
    counterNumber: Number(counterNumber),
    name: name || `Counter ${counterNumber}`,
    roomNumber: resolvedRoom,
    status: 'OFFLINE',
    isActive: false
  });

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: departmentId.toString(),
    counter,
    event: 'counter.created'
  });

  return counter;
}

/**
 * Assign a worker to a counter (and update Worker.counterId)
 */
async function assignWorker({ counterId, workerId, organizationId }) {
  if (!isValidObjectId(counterId)) throw new Error('Valid counterId is required');
  if (!isValidObjectId(workerId)) throw new Error('Valid workerId is required');

  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found or tenant mismatch');

  const worker = await Worker.findOne({ _id: workerId, organizationId });
  if (!worker) throw new Error('Worker not found or tenant mismatch');

  // Unassign from previous counter if any
  if (worker.counterId && worker.counterId.toString() !== counterId.toString()) {
    await Counter.findByIdAndUpdate(worker.counterId, {
      assignedWorkerId: null,
      status: 'OFFLINE',
      isActive: false
    });
  }

  counter.assignedWorkerId = workerId;
  if (counter.status === 'OFFLINE') counter.status = 'AVAILABLE';
  counter.isActive = true;
  await counter.save();

  worker.counterId = counterId;
  worker.departmentId = counter.departmentId;
  worker.status = 'AVAILABLE';
  await worker.save();

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: counter.departmentId.toString(),
    counter,
    event: 'worker.assigned'
  });

  return { counter, worker };
}

/**
 * Unassign worker from a counter
 */
async function unassignWorker({ counterId, organizationId }) {
  if (!isValidObjectId(counterId)) throw new Error('Valid counterId is required');

  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found or tenant mismatch');

  if (counter.assignedWorkerId) {
    await Worker.findByIdAndUpdate(counter.assignedWorkerId, {
      counterId: null,
      status: 'OFFLINE'
    });
  }

  counter.assignedWorkerId = null;
  counter.status = 'OFFLINE';
  counter.isActive = false;
  await counter.save();

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: counter.departmentId.toString(),
    counter,
    event: 'worker.unassigned'
  });

  return counter;
}

/**
 * Activate a counter (make it AVAILABLE)
 */
async function activateCounter({ counterId, organizationId }) {
  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found or tenant mismatch');

  counter.status = 'AVAILABLE';
  counter.isActive = true;
  await counter.save();

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: counter.departmentId.toString(),
    counter,
    event: 'counter.activated'
  });
  return counter;
}

/**
 * Put counter on BREAK
 */
async function counterBreak({ counterId, organizationId, workerId }) {
  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found or tenant mismatch');

  // Verify requesting worker is assigned to this counter
  if (workerId && counter.assignedWorkerId &&
    counter.assignedWorkerId.toString() !== workerId.toString()) {
    throw new Error('Forbidden: You are not assigned to this counter');
  }

  counter.status = 'PAUSED';
  await counter.save();

  if (workerId && isValidObjectId(workerId)) {
    await Worker.findByIdAndUpdate(workerId, { status: 'ON_BREAK' });
  }

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: counter.departmentId.toString(),
    counter,
    event: 'counter.break'
  });
  return counter;
}

/**
 * Resume counter from BREAK → AVAILABLE
 */
async function resumeCounter({ counterId, organizationId, workerId }) {
  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found or tenant mismatch');

  if (workerId && counter.assignedWorkerId &&
    counter.assignedWorkerId.toString() !== workerId.toString()) {
    throw new Error('Forbidden: You are not assigned to this counter');
  }

  counter.status = 'AVAILABLE';
  counter.isActive = true;
  await counter.save();

  if (workerId && isValidObjectId(workerId)) {
    await Worker.findByIdAndUpdate(workerId, { status: 'AVAILABLE' });
  }

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: counter.departmentId.toString(),
    counter,
    event: 'counter.resumed'
  });
  return counter;
}

/**
 * Take counter OFFLINE
 */
async function offlineCounter({ counterId, organizationId }) {
  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found or tenant mismatch');

  counter.status = 'OFFLINE';
  counter.isActive = false;
  await counter.save();

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: counter.departmentId.toString(),
    counter,
    event: 'counter.offline'
  });
  return counter;
}

/**
 * Pause counter (e.g. temporary hold, not full break)
 */
async function pauseCounter({ counterId, organizationId }) {
  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found or tenant mismatch');

  counter.status = 'PAUSED';
  await counter.save();

  emitQueueEvent('counter.updated', {
    orgId: organizationId.toString(),
    deptId: counter.departmentId.toString(),
    counter,
    event: 'counter.paused'
  });
  return counter;
}

/**
 * Get counters for a department with tenant isolation
 */
async function getDepartmentCounters({ departmentId, organizationId }) {
  const filter = { departmentId };
  if (organizationId) filter.organizationId = organizationId;

  return Counter.find(filter)
    .populate('assignedWorkerId', 'name role status authUserId')
    .populate('currentTicketId', 'ticketNumber status priority calledAt serviceStartedAt')
    .sort({ counterNumber: 1 });
}

module.exports = {
  createCounter,
  assignWorker,
  unassignWorker,
  activateCounter,
  counterBreak,
  resumeCounter,
  offlineCounter,
  pauseCounter,
  getDepartmentCounters
};

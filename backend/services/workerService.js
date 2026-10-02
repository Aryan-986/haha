/**
 * workerService.js
 * Worker session, break, and profile management — Phase 2
 */

const mongoose = require('mongoose');
const Worker = require('../models/Worker');
const Counter = require('../models/Counter');
const QueueEvent = require('../models/QueueEvent');
const { emitQueueEvent } = require('../socket');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Resolve worker from authUserId, with tenant enforcement
 * @param {string} authUserId - Clerk user ID
 * @param {string} [organizationId] - Optional org scope for additional validation
 */
async function resolveWorker(authUserId, organizationId = null) {
  if (!authUserId) throw new Error('authUserId is required to resolve worker identity');

  const filter = { authUserId };
  if (organizationId && isValidObjectId(organizationId)) {
    filter.organizationId = organizationId;
  }

  const worker = await Worker.findOne(filter)
    .populate('organizationId', 'name type status')
    .populate('departmentId', 'name prefix roomNumber avgServiceTimeMins')
    .populate('counterId', 'name counterNumber status currentTicketId isActive');

  return worker;
}

/**
 * Get full worker profile with their counter and department info
 */
async function getWorkerProfile(authUserId) {
  const worker = await resolveWorker(authUserId);
  if (!worker) return null;

  let currentTicket = null;
  if (worker.counterId?.currentTicketId) {
    const Ticket = require('../models/Ticket');
    currentTicket = await Ticket.findById(worker.counterId.currentTicketId)
      .populate('currentDepartmentId', 'name prefix');
  }

  return { worker, currentTicket };
}

/**
 * Update worker status
 */
async function updateWorkerStatus({ workerId, status, organizationId }) {
  const allowedStatuses = ['AVAILABLE', 'BUSY', 'OFFLINE', 'ON_BREAK'];
  if (!allowedStatuses.includes(status)) {
    throw new Error(`Invalid worker status: ${status}. Must be one of: ${allowedStatuses.join(', ')}`);
  }

  const filter = { _id: workerId };
  if (organizationId) filter.organizationId = organizationId;

  const worker = await Worker.findOneAndUpdate(
    filter,
    { status },
    { returnDocument: 'after' }
  );

  if (!worker) throw new Error('Worker not found or tenant mismatch');

  emitQueueEvent('worker.updated', {
    orgId: worker.organizationId.toString(),
    workerId: worker._id.toString(),
    status,
    event: 'worker.status_changed'
  });

  return worker;
}

/**
 * Worker starts break — sets worker BREAK and counter PAUSED
 */
async function startWorkerBreak({ workerId, organizationId }) {
  if (!isValidObjectId(workerId)) throw new Error('Valid workerId required');

  const worker = await Worker.findOne({ _id: workerId, organizationId });
  if (!worker) throw new Error('Worker not found or tenant mismatch');

  if (worker.status === 'ON_BREAK') {
    throw new Error('Worker is already on break');
  }

  worker.status = 'ON_BREAK';
  await worker.save();

  // Also pause the counter
  if (worker.counterId) {
    await Counter.findByIdAndUpdate(worker.counterId, { status: 'PAUSED' });

    emitQueueEvent('counter.updated', {
      orgId: organizationId.toString(),
      deptId: worker.departmentId?.toString() || '',
      counterId: worker.counterId.toString(),
      event: 'counter.break'
    });
  }

  emitQueueEvent('worker.updated', {
    orgId: organizationId.toString(),
    workerId: worker._id.toString(),
    status: 'ON_BREAK',
    event: 'worker.break_started'
  });

  return worker;
}

/**
 * Worker ends break — sets worker AVAILABLE and counter AVAILABLE
 */
async function endWorkerBreak({ workerId, organizationId }) {
  if (!isValidObjectId(workerId)) throw new Error('Valid workerId required');

  const worker = await Worker.findOne({ _id: workerId, organizationId });
  if (!worker) throw new Error('Worker not found or tenant mismatch');

  worker.status = 'AVAILABLE';
  await worker.save();

  if (worker.counterId) {
    await Counter.findByIdAndUpdate(worker.counterId, {
      status: 'AVAILABLE',
      isActive: true
    });

    emitQueueEvent('counter.updated', {
      orgId: organizationId.toString(),
      deptId: worker.departmentId?.toString() || '',
      counterId: worker.counterId.toString(),
      event: 'counter.resumed'
    });
  }

  emitQueueEvent('worker.updated', {
    orgId: organizationId.toString(),
    workerId: worker._id.toString(),
    status: 'AVAILABLE',
    event: 'worker.break_ended'
  });

  return worker;
}

/**
 * Verify that a worker has access to operate a specific counter.
 * Throws if unauthorized.
 */
async function assertWorkerCounterAccess(workerId, counterId, organizationId) {
  const worker = await Worker.findOne({ _id: workerId, organizationId });
  if (!worker) throw new Error('Worker not found');

  const counter = await Counter.findOne({ _id: counterId, organizationId });
  if (!counter) throw new Error('Counter not found');

  // SUPERVISOR and above can access any counter in their org
  if (['SUPERVISOR', 'ORG_ADMIN', 'MASTER_ADMIN'].includes(worker.role)) {
    return { worker, counter };
  }

  // Regular worker must be assigned to the counter
  if (!counter.assignedWorkerId ||
    counter.assignedWorkerId.toString() !== workerId.toString()) {
    throw new Error('Forbidden: You are not assigned to this counter');
  }

  if (worker.status === 'ON_BREAK') {
    throw new Error('Cannot perform operations while on break');
  }

  return { worker, counter };
}

/**
 * List all workers for an organization/department
 */
async function listWorkers({ organizationId, departmentId }) {
  const filter = {};
  if (organizationId) filter.organizationId = organizationId;
  if (departmentId) filter.departmentId = departmentId;

  return Worker.find(filter)
    .populate('departmentId', 'name prefix')
    .populate('counterId', 'name counterNumber status')
    .sort({ name: 1 });
}

module.exports = {
  resolveWorker,
  getWorkerProfile,
  updateWorkerStatus,
  startWorkerBreak,
  endWorkerBreak,
  assertWorkerCounterAccess,
  listWorkers
};

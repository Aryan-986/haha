const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Counter = require('../models/Counter');
const Worker = require('../models/Worker');
const Ticket = require('../models/Ticket');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

/**
 * Safely archive/soft-delete an organization and cascade offline status to related resources.
 * Only callable with MASTER_ADMIN authority.
 */
async function archiveOrganization(orgId, { userRole, userId } = {}) {
  if (!isValidObjectId(orgId)) {
    const err = new Error('Invalid Organization ID format');
    err.status = 400;
    throw err;
  }

  // Strict role verification: only Master Admin permitted
  if (userRole !== 'master_admin' && userRole !== 'MASTER_ADMIN') {
    const err = new Error('Forbidden: Only Master Admin can delete organizations');
    err.status = 403;
    throw err;
  }

  const org = await Organization.findById(orgId);
  if (!org) {
    const err = new Error('Organization not found');
    err.status = 404;
    throw err;
  }

  if (org.isDeleted) {
    const err = new Error('Organization is already archived');
    err.status = 400;
    throw err;
  }

  // Soft-delete organization
  org.isDeleted = true;
  org.deletedAt = new Date();
  org.deletedBy = userId || 'master_admin';
  org.status = 'INACTIVE';
  await org.save();

  // Cascade: Cancel active waiting/snoozed/transferred tickets
  await Ticket.updateMany(
    { organizationId: orgId, status: { $in: ['WAITING', 'SNOOZED', 'TRANSFERRED'] } },
    { $set: { status: 'CANCELLED' } }
  );

  // Cascade: Deactivate counters
  await Counter.updateMany(
    { organizationId: orgId },
    { $set: { status: 'OFFLINE', isActive: false, currentTicketId: null } }
  );

  // Cascade: Set workers to OFFLINE
  await Worker.updateMany(
    { organizationId: orgId },
    { $set: { status: 'OFFLINE' } }
  );

  return org;
}

module.exports = {
  archiveOrganization
};

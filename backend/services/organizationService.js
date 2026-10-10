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
async function archiveOrganization(orgId, options = {}) {
  let userRole = options?.userRole;
  let userId = options?.userId;
  if (typeof orgId === 'object' && orgId !== null && orgId.orgId) {
    userRole = orgId.userRole;
    userId = orgId.userId;
    orgId = orgId.orgId;
  }

  if (!isValidObjectId(orgId)) {
    const err = new Error('Invalid Organization ID format');
    err.status = 400;
    throw err;
  }

  // Authentication check: role must be present
  if (!userRole) {
    const err = new Error('Unauthorized: Authentication required. Only Master Admin can delete organizations');
    err.status = 401;
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

/**
 * Update an existing organization.
 * Only callable with MASTER_ADMIN authority.
 * Preserves all departments, counters, workers, tickets, and QueueEvents.
 */
async function updateOrganization(orgId, updateData, options = {}) {
  let userRole = options?.userRole;
  let userId = options?.userId;
  if (typeof orgId === 'object' && orgId !== null && orgId.orgId) {
    userRole = orgId.userRole;
    userId = orgId.userId;
    updateData = orgId.updates || orgId.updateData || {};
    orgId = orgId.orgId;
  }

  // Authentication check: role must be present
  if (!userRole) {
    const err = new Error('Unauthorized: Authentication required. Only Master Admin can edit organizations');
    err.status = 401;
    throw err;
  }

  // Strict role verification: only Master Admin permitted
  if (userRole !== 'master_admin' && userRole !== 'MASTER_ADMIN') {
    const err = new Error('Forbidden: Only Master Admin can edit organizations');
    err.status = 403;
    throw err;
  }

  if (!isValidObjectId(orgId)) {
    const err = new Error('Invalid Organization ID format');
    err.status = 400;
    throw err;
  }

  const org = await Organization.findById(orgId);
  if (!org) {
    const err = new Error('Organization not found');
    err.status = 404;
    throw err;
  }

  if (org.isDeleted) {
    const err = new Error('Cannot edit an archived organization');
    err.status = 400;
    throw err;
  }

  const { name, type, address, status, description, timezone, code } = updateData;

  if (name !== undefined) {
    if (!name || !name.trim()) {
      const err = new Error('Organization name is required');
      err.status = 400;
      throw err;
    }

    // Check duplicate name among active organizations
    const duplicate = await Organization.findOne({
      _id: { $ne: orgId },
      name: name.trim(),
      isDeleted: { $ne: true }
    });
    if (duplicate) {
      const err = new Error(`An active organization with name "${name.trim()}" already exists`);
      err.status = 409;
      throw err;
    }

    org.name = name.trim();
  }

  if (type !== undefined) {
    const validTypes = ['HOSPITAL', 'GOVERNMENT', 'PRIVATE'];
    if (!validTypes.includes(type)) {
      const err = new Error(`Invalid organization type. Allowed: ${validTypes.join(', ')}`);
      err.status = 400;
      throw err;
    }
    org.type = type;
  }

  if (address !== undefined) {
    org.address = String(address).trim();
  }

  if (description !== undefined) {
    org.description = String(description).trim();
  }

  if (timezone !== undefined) {
    org.timezone = String(timezone).trim();
  }

  if (code !== undefined) {
    const trimmedCode = String(code).trim().toUpperCase();
    if (trimmedCode) {
      const duplicateCode = await Organization.findOne({
        _id: { $ne: orgId },
        code: trimmedCode,
        isDeleted: { $ne: true }
      });
      if (duplicateCode) {
        const err = new Error(`An active organization with code "${trimmedCode}" already exists`);
        err.status = 409;
        throw err;
      }
      org.code = trimmedCode;
    }
  }

  if (status !== undefined) {
    const validStatuses = ['ACTIVE', 'INACTIVE', 'SUSPENDED'];
    if (!validStatuses.includes(status)) {
      const err = new Error(`Invalid status. Allowed: ${validStatuses.join(', ')}`);
      err.status = 400;
      throw err;
    }
    org.status = status;
  }

  await org.save();
  return org;
}

/**
 * List active organizations.
 */
async function listOrganizations(filter = {}) {
  const query = { isDeleted: { $ne: true } };
  if (filter.status) query.status = filter.status;
  return await Organization.find(query).sort({ createdAt: -1 });
}

module.exports = {
  archiveOrganization,
  updateOrganization,
  listOrganizations
};

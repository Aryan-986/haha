const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Counter = require('../models/Counter');
const Worker = require('../models/Worker');
const Ticket = require('../models/Ticket');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// POST /api/v1/orgs - Create an organization (auto-generates apiKey if not supplied)
router.post('/', async (req, res) => {
  try {
    const { name, type, address, apiKey, status } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Organization name is required' });
    }

    const orgPayload = {
      name: name.trim(),
      address: address ? address.trim() : '',
      status: status || 'ACTIVE'
    };

    if (type) {
      orgPayload.type = type;
    }
    if (apiKey) {
      orgPayload.apiKey = apiKey;
    }

    const newOrg = await Organization.create(orgPayload);
    res.status(201).json({
      success: true,
      message: 'Organization created successfully',
      organization: newOrg
    });
  } catch (err) {
    console.error('ERROR in POST /api/v1/orgs:', err);
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Duplicate key error: apiKey or organization already exists' });
    }
    res.status(500).json({ error: 'Failed to create organization', details: err.message });
  }
});

// GET /api/v1/orgs - Get all organizations (excludes deleted by default)
router.get('/', async (req, res) => {
  try {
    const filter = { isDeleted: { $ne: true } };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    // Allow admin to see deleted with ?includeDeleted=true
    if (req.query.includeDeleted === 'true') {
      delete filter.isDeleted;
    }

    const organizations = await Organization.find(filter).sort({ createdAt: -1 });
    res.json(organizations);
  } catch (err) {
    console.error('ERROR in GET /api/v1/orgs:', err);
    res.status(500).json({ error: 'Failed to fetch organizations', details: err.message });
  }
});

// GET /api/v1/orgs/:orgId - Get single organization
router.get('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isValidObjectId(orgId)) {
      return res.status(400).json({ error: 'Invalid Organization ID format' });
    }

    const org = await Organization.findOne({ _id: orgId, isDeleted: { $ne: true } });
    if (!org) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json(org);
  } catch (err) {
    console.error('ERROR in GET /api/v1/orgs/:orgId:', err);
    res.status(500).json({ error: 'Failed to fetch organization', details: err.message });
  }
});

const { archiveOrganization, updateOrganization } = require('../services/organizationService');
const { resolveUserRole } = require('../middleware/authMiddleware');

// Helper to reliably extract authenticated user role and ID from request
const getAuthUser = async (req) => {
  const userId = req.auth?.userId;
  const userRole = await resolveUserRole(req);
  return { userId, userRole };
};

// PUT /api/v1/orgs/:orgId - Update an organization (Master Admin only)
router.put('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { userId, userRole } = await getAuthUser(req);

    // If Clerk is active and request lacks authenticated session
    if (process.env.CLERK_SECRET_KEY && !userId && process.env.NODE_ENV !== 'test') {
      return res.status(401).json({ error: 'Unauthorized: Authentication required. Please sign in as Master Admin.' });
    }

    if (!userRole) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required. Please sign in as Master Admin.' });
    }

    const normalizedRole = (userRole || '').toLowerCase();
    if (normalizedRole !== 'master_admin') {
      return res.status(403).json({ error: 'Forbidden: Only Master Admin can edit organizations' });
    }

    const org = await updateOrganization(orgId, req.body, { userRole, userId });

    res.json({
      success: true,
      message: `Organization "${org.name}" updated successfully`,
      organization: org
    });
  } catch (err) {
    console.error('ERROR in PUT /api/v1/orgs/:orgId:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /api/v1/orgs/:orgId - Soft-delete (archive) an organization
// Requires MASTER_ADMIN role (verified via Clerk session claims or SDK)
router.delete('/:orgId', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { userId, userRole } = await getAuthUser(req);

    // If Clerk is active and request lacks authenticated session
    if (process.env.CLERK_SECRET_KEY && !userId && process.env.NODE_ENV !== 'test') {
      return res.status(401).json({ error: 'Unauthorized: Authentication required. Please sign in as Master Admin.' });
    }

    if (!userRole) {
      return res.status(401).json({ error: 'Unauthorized: Authentication required. Please sign in as Master Admin.' });
    }

    const normalizedRole = (userRole || '').toLowerCase();
    if (normalizedRole !== 'master_admin') {
      return res.status(403).json({ error: 'Forbidden: Only Master Admin can delete organizations' });
    }

    const org = await archiveOrganization(orgId, { userRole, userId });

    res.json({
      success: true,
      message: `Organization "${org.name}" has been archived successfully`,
      organization: org
    });
  } catch (err) {
    console.error('ERROR in DELETE /api/v1/orgs/:orgId:', err.message);
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/v1/orgs/:orgId/departments - Create dynamic department under an organization
router.post('/:orgId/departments', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, prefix, avgServiceTimeMins, subCounters, isEntryLevel, roomNumber } = req.body;

    if (!isValidObjectId(orgId)) {
      return res.status(400).json({ error: 'Invalid Organization ID format' });
    }

    const organization = await Organization.findOne({ _id: orgId, isDeleted: { $ne: true } });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Department name is required' });
    }

    if (!prefix || !prefix.trim()) {
      return res.status(400).json({ error: 'Department prefix is required (e.g., TRG, DOC)' });
    }

    const newDept = await Department.create({
      orgId,
      name: name.trim(),
      prefix: prefix.trim().toUpperCase(),
      avgServiceTimeMins: Number(avgServiceTimeMins) || 5,
      subCounters: Array.isArray(subCounters) ? subCounters : [],
      isEntryLevel: Boolean(isEntryLevel),
      roomNumber: roomNumber ? String(roomNumber).trim() : ''
    });

    res.status(201).json({
      success: true,
      message: 'Department created successfully',
      department: newDept
    });
  } catch (err) {
    console.error('ERROR in POST /api/v1/orgs/:orgId/departments:', err);
    res.status(500).json({ error: 'Failed to create department', details: err.message });
  }
});

// GET /api/v1/orgs/:orgId/departments - Fetch all departments for an organization
router.get('/:orgId/departments', async (req, res) => {
  try {
    const { orgId } = req.params;

    if (!isValidObjectId(orgId)) {
      return res.status(400).json({ error: 'Invalid Organization ID format' });
    }

    const organization = await Organization.findOne({ _id: orgId, isDeleted: { $ne: true } });
    if (!organization) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const departments = await Department.find({ orgId }).sort({ isEntryLevel: -1, createdAt: 1 });
    res.json(departments);
  } catch (err) {
    console.error('ERROR in GET /api/v1/orgs/:orgId/departments:', err);
    res.status(500).json({ error: 'Failed to fetch departments', details: err.message });
  }
});

module.exports = router;

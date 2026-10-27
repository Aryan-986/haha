const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Counter = require('../models/Counter');
const Worker = require('../models/Worker');
const Ticket = require('../models/Ticket');
const ServiceWorkflow = require('../models/ServiceWorkflow');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');
const { archiveOrganization, updateOrganization } = require('../services/organizationService');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// POST /api/v1/orgs - Create an organization (Master Admin only)
router.post('/', requireAuth, checkRole(['master_admin']), async (req, res) => {
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

// GET /api/v1/orgs - Get all organizations (excludes deleted by default; includeDeleted requires admin)
router.get('/', async (req, res) => {
  try {
    const filter = { isDeleted: { $ne: true } };
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    // includeDeleted requires authentication and master_admin role
    if (req.query.includeDeleted === 'true' && req.auth?.userId) {
      // Only master_admin can see deleted orgs — silently ignore for others
      const { resolveUserRole } = require('../middleware/authMiddleware');
      const role = await resolveUserRole(req);
      if (role === 'master_admin') {
        delete filter.isDeleted;
      }
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

// PUT /api/v1/orgs/:orgId - Update an organization (Master Admin only)
router.put('/:orgId', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.auth.userId;
    const userRole = req.userRole || 'master_admin';

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
router.delete('/:orgId', requireAuth, checkRole(['master_admin']), async (req, res) => {
  try {
    const { orgId } = req.params;
    const userId = req.auth.userId;
    const userRole = req.userRole || 'master_admin';

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

// POST /api/v1/orgs/:orgId/departments - Create department (Master Admin or Supervisor only)
router.post('/:orgId/departments', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
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

// POST /api/v1/orgs/:orgId/service-workflows - Create a Service Workflow
const createWorkflowHandler = async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, description, entryDepartmentId, stages, isActive } = req.body;

    if (!isValidObjectId(orgId)) {
      return res.status(400).json({ success: false, error: 'Invalid Organization ID format' });
    }

    const org = await Organization.findOne({ _id: orgId, isDeleted: { $ne: true } });
    if (!org || org.status === 'INACTIVE') {
      return res.status(404).json({ success: false, error: 'Organization not found or inactive' });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Workflow name is required' });
    }

    if (!entryDepartmentId || !isValidObjectId(entryDepartmentId)) {
      return res.status(400).json({ success: false, error: 'Valid entryDepartmentId is required' });
    }

    const entryDept = await Department.findOne({ _id: entryDepartmentId, orgId });
    if (!entryDept) {
      return res.status(400).json({ success: false, error: 'entryDepartmentId does not belong to specified organization' });
    }

    // Validate stages if provided
    const formattedStages = [];
    if (Array.isArray(stages)) {
      for (let i = 0; i < stages.length; i++) {
        const stage = stages[i];
        if (!stage.departmentId || !isValidObjectId(stage.departmentId)) {
          return res.status(400).json({ success: false, error: `Invalid departmentId at stage index ${i}` });
        }
        const stageDept = await Department.findOne({ _id: stage.departmentId, orgId });
        if (!stageDept) {
          return res.status(400).json({ success: false, error: `Stage department at index ${i} does not belong to organization` });
        }
        formattedStages.push({
          departmentId: stage.departmentId,
          name: stage.name || stageDept.name,
          order: typeof stage.order === 'number' ? stage.order : i,
          isOptional: Boolean(stage.isOptional),
          allowedNextDepartments: Array.isArray(stage.allowedNextDepartments)
            ? stage.allowedNextDepartments.filter(isValidObjectId)
            : []
        });
      }
    }

    const workflow = await ServiceWorkflow.create({
      organizationId: orgId,
      name: name.trim(),
      description: description ? description.trim() : '',
      entryDepartmentId,
      stages: formattedStages,
      isActive: isActive !== undefined ? Boolean(isActive) : true
    });

    res.status(201).json({
      success: true,
      message: 'Service workflow created successfully',
      workflow
    });
  } catch (err) {
    console.error('ERROR in POST /service-workflows:', err);
    res.status(500).json({ success: false, error: 'Failed to create service workflow', details: err.message });
  }
};

router.post('/:orgId/service-workflows', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), createWorkflowHandler);
router.post('/:orgId/workflows', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), createWorkflowHandler);

// GET /api/v1/orgs/:orgId/service-workflows - List Service Workflows for an organization (public)
const listWorkflowsHandler = async (req, res) => {
  try {
    const { orgId } = req.params;
    if (!isValidObjectId(orgId)) {
      return res.status(400).json({ success: false, error: 'Invalid Organization ID format' });
    }

    const workflows = await ServiceWorkflow.find({
      organizationId: orgId,
      isActive: true
    })
      .populate('entryDepartmentId', 'name prefix roomNumber avgServiceTimeMins')
      .populate('stages.departmentId', 'name prefix roomNumber avgServiceTimeMins')
      .populate('stages.allowedNextDepartments', 'name prefix roomNumber')
      .sort({ createdAt: 1 });

    res.json(workflows);
  } catch (err) {
    console.error('ERROR in GET /service-workflows:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch service workflows', details: err.message });
  }
};

router.get('/:orgId/service-workflows', listWorkflowsHandler);
router.get('/:orgId/workflows', listWorkflowsHandler);

module.exports = router;


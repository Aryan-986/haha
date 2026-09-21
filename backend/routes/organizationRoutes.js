const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Organization = require('../models/Organization');
const Department = require('../models/Department');

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

// GET /api/v1/orgs - Get all organizations
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;

    const organizations = await Organization.find(filter).sort({ createdAt: -1 });
    res.json(organizations);
  } catch (err) {
    console.error('ERROR in GET /api/v1/orgs:', err);
    res.status(500).json({ error: 'Failed to fetch organizations', details: err.message });
  }
});

// POST /api/v1/orgs/:orgId/departments - Create dynamic department under an organization
router.post('/:orgId/departments', async (req, res) => {
  try {
    const { orgId } = req.params;
    const { name, prefix, avgServiceTimeMins, subCounters, isEntryLevel } = req.body;

    if (!isValidObjectId(orgId)) {
      return res.status(400).json({ error: 'Invalid Organization ID format' });
    }

    const organization = await Organization.findById(orgId);
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
      isEntryLevel: Boolean(isEntryLevel)
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

    const organization = await Organization.findById(orgId);
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

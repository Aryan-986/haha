const express = require('express');
const router = express.Router();
const { clerkClient } = require('@clerk/express');
const { checkRole, userCache } = require('../middleware/authMiddleware');
const Service = require('../models/Service');
const Worker = require('../models/Worker');
const Organization = require('../models/Organization');
const Department = require('../models/Department');
const Counter = require('../models/Counter');

// Master Admin authentication guard for all admin routes
router.use(checkRole(['master_admin']));

// GET /api/v1/admin/users - List users from Clerk merged with MongoDB worker assignment
router.get('/users', async (req, res) => {
  try {
    let clerkUsers = [];
    if (process.env.CLERK_SECRET_KEY) {
      try {
        const userList = await clerkClient.users.getUserList({ limit: 100 });
        clerkUsers = userList.data ? userList.data : userList;
      } catch (clerkErr) {
        console.warn('Clerk user list fetch failed:', clerkErr.message);
      }
    }

    // Fetch existing MongoDB workers
    const dbWorkers = await Worker.find()
      .populate('organizationId', 'name type')
      .populate('departmentId', 'name prefix roomNumber')
      .populate('counterId', 'name counterNumber');

    const workerByAuthId = new Map();
    dbWorkers.forEach(w => {
      if (w.authUserId) workerByAuthId.set(w.authUserId, w);
    });

    const result = clerkUsers.map(u => {
      const dbWorker = workerByAuthId.get(u.id);
      const email = u.emailAddresses?.[0]?.emailAddress || '';
      const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || email || 'User';
      const role = u.publicMetadata?.role || dbWorker?.role?.toLowerCase() || 'citizen';
      const orgId = u.publicMetadata?.organizationId || dbWorker?.organizationId?._id?.toString() || null;
      const deptId = u.publicMetadata?.departmentId || dbWorker?.departmentId?._id?.toString() || null;
      const counterId = u.publicMetadata?.counterId || dbWorker?.counterId?._id?.toString() || null;

      return {
        id: u.id,
        email,
        name,
        role,
        organizationId: orgId,
        organizationName: dbWorker?.organizationId?.name || null,
        departmentId: deptId,
        departmentName: dbWorker?.departmentId?.name || null,
        counterId: counterId,
        counterName: dbWorker?.counterId?.name || null,
        workerId: dbWorker?._id || null,
        status: dbWorker?.status || 'AVAILABLE'
      };
    });

    res.json({ success: true, users: result });
  } catch (err) {
    console.error('ERROR in GET /admin/users:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/admin/users/assign - Assign user role, organization, and department
router.post('/users/assign', async (req, res) => {
  try {
    const { userId, role, organizationId, departmentId, counterId, name } = req.body;

    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const normalizedRole = (role || 'citizen').toLowerCase();
    const validRoles = ['master_admin', 'supervisor', 'worker', 'citizen'];
    if (!validRoles.includes(normalizedRole)) {
      return res.status(400).json({ error: `Invalid role: ${role}. Must be one of: ${validRoles.join(', ')}` });
    }

    if (['worker', 'supervisor'].includes(normalizedRole) && !organizationId) {
      return res.status(400).json({ error: 'Organization is required for Worker and Supervisor roles' });
    }

    // 1. Update Clerk user public metadata
    if (process.env.CLERK_SECRET_KEY) {
      await clerkClient.users.updateUserMetadata(userId, {
        publicMetadata: {
          role: normalizedRole,
          organizationId: organizationId || null,
          departmentId: departmentId || null,
          counterId: counterId || null
        }
      });
      // Invalidate memory cache so change takes effect immediately
      userCache.delete(userId);
    }

    // 2. Sync to MongoDB Worker model if role is worker or supervisor
    let dbWorker = null;
    if (['worker', 'supervisor', 'master_admin'].includes(normalizedRole) && organizationId) {
      const workerPayload = {
        authUserId: userId,
        organizationId,
        departmentId: departmentId || null,
        counterId: counterId || null,
        role: normalizedRole.toUpperCase(),
        status: 'AVAILABLE'
      };
      if (name) workerPayload.name = name;

      dbWorker = await Worker.findOneAndUpdate(
        { authUserId: userId },
        { $set: workerPayload },
        { upsert: true, new: true }
      );
    } else if (normalizedRole === 'citizen') {
      // If downgraded to citizen, remove worker record
      await Worker.deleteOne({ authUserId: userId });
    }

    res.json({
      success: true,
      message: `User assigned as ${normalizedRole.toUpperCase()} successfully`,
      worker: dbWorker
    });
  } catch (err) {
    console.error('ERROR in POST /admin/users/assign:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new organization/office (legacy service model)
router.post('/organizations/add', async (req, res) => {
  try {
    const { name, office, activeCounters, avgServiceTimeMin, enabledFeatures } = req.body;
    const newService = await Service.create({
      name,
      office,
      activeCounters: activeCounters || 1,
      avgServiceTimeMin: avgServiceTimeMin || 5,
      currentQueueCount: 0,
      enabledFeatures: enabledFeatures || {
        allowQueueManualAdjust: true,
        allowCounterToggle: true
      }
    });
    res.json({ success: true, service: newService });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update organization details or feature permissions
router.put('/organizations/:id/config', async (req, res) => {
  try {
    const { enabledFeatures, activeCounters, avgServiceTimeMin } = req.body;
    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      { enabledFeatures, activeCounters, avgServiceTimeMin },
      { new: true }
    );
    res.json({ success: true, service: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
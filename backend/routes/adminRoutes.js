const express = require('express');
const router = express.Router();
const { requireAuth } = require('@clerk/express');
const { checkRole } = require('../middleware/authMiddleware');
const Service = require('../models/Service');

router.use(requireAuth());
router.use(checkRole(['master_admin']));

// Create a new organization/office
router.post('/organizations/add', async (req, res) => {
  try {
    const { name, office, activeCounters, avgServiceTimeMin, enabledFeatures } = req.body;
    const newService = await Service.create({
      name,
      office,
      activeCounters: activeCounters || 1,
      avgServiceTimeMin: avgServiceTimeMin || 5,
      currentQueueCount: 0,
      // Configuration flags set by Master Admin for Workers
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
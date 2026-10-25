/**
 * departmentRoutes.js
 * Department, Counter, and Supervisor operations — Phase 2
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const queueService = require('../services/queueService');
const counterService = require('../services/counterService');
const Counter = require('../models/Counter');
const Department = require('../models/Department');
const { requireAuth, checkRole } = require('../middleware/authMiddleware');

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// GET /api/v1/departments/:id/queue - Live queue metrics for department (public/display OK)
router.get('/:id/queue', async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId } = req.query;
    const metrics = await queueService.getDepartmentQueueMetrics(id, orgId);
    res.json({ success: true, ...metrics });
  } catch (err) {
    console.error('Error in GET /departments/:id/queue:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/departments/:id/live - Supervisor full live view with alerts (Staff only)
router.get('/:id/live', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId } = req.query;
    const liveView = await queueService.getDepartmentLiveView(id, orgId);
    res.json({ success: true, ...liveView });
  } catch (err) {
    console.error('Error in GET /departments/:id/live:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/departments/:id/call-next - Atomically call next ticket (Staff only)
router.post('/:id/call-next', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin', 'worker']), async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId, counterId, workerId, roomId } = req.body;
    const result = await queueService.callNextTicket({
      departmentId: id,
      organizationId: orgId,
      counterId,
      workerId,
      roomId
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in POST /departments/:id/call-next:', err);
    res.status(err.status || 500).json({ success: false, error: err.message });
  }
});

// GET /api/v1/departments/:id/counters - List counters for department
router.get('/:id/counters', async (req, res) => {
  try {
    const { id } = req.params;
    const { orgId } = req.query;
    if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid department ID' });
    const counters = await counterService.getDepartmentCounters({
      departmentId: id,
      organizationId: orgId && isValidObjectId(orgId) ? orgId : null
    });
    res.json({ success: true, counters });
  } catch (err) {
    console.error('Error in GET /departments/:id/counters:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/departments/:id/counters - Create counter under department (Admin/Supervisor only)
router.post('/:id/counters', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { counterNumber, name, organizationId, roomNumber, status, isActive } = req.body;
    if (!isValidObjectId(id)) return res.status(400).json({ error: 'Invalid department ID' });

    const dept = await Department.findById(id);
    if (!dept) return res.status(404).json({ error: 'Department not found' });

    const counter = await counterService.createCounter({
      organizationId: organizationId || dept.orgId,
      departmentId: id,
      counterNumber: Number(counterNumber) || 1,
      name: name || `Counter ${counterNumber || 1}`,
      roomNumber: roomNumber !== undefined ? roomNumber : dept.roomNumber,
      status: status || undefined,
      isActive: isActive !== undefined ? isActive : undefined
    });

    res.status(201).json({ success: true, counter });
  } catch (err) {
    console.error('Error in POST /departments/:id/counters:', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

const Ticket = require('../models/Ticket');

// GET /api/v1/departments/:id/rooms - List rooms for department
router.get('/:id/rooms', async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, error: 'Invalid department ID' });

    const dept = await Department.findById(id);
    if (!dept) return res.status(404).json({ success: false, error: 'Department not found' });

    let rooms = dept.rooms || [];
    // If no rooms array yet but dept has a default roomNumber, synthesize a default room
    if (rooms.length === 0 && dept.roomNumber) {
      rooms = [{
        _id: dept._id,
        roomNumber: dept.roomNumber,
        name: `${dept.name} Main Room`,
        isActive: true,
        isDefault: true
      }];
    }

    res.json({ success: true, rooms });
  } catch (err) {
    console.error('Error in GET /departments/:id/rooms:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/v1/departments/:id/rooms - Create a room in department (Admin/Supervisor only)
router.post('/:id/rooms', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { roomNumber, name } = req.body;

    if (!isValidObjectId(id)) return res.status(400).json({ success: false, error: 'Invalid department ID' });
    if (!roomNumber || !String(roomNumber).trim()) {
      return res.status(400).json({ success: false, error: 'roomNumber is required' });
    }

    const trimmedRoom = String(roomNumber).trim();
    const dept = await Department.findById(id);
    if (!dept) return res.status(404).json({ success: false, error: 'Department not found' });

    // Check for duplicate roomNumber in this department
    const isDuplicate = (dept.rooms || []).some(
      r => r.roomNumber.toLowerCase() === trimmedRoom.toLowerCase()
    );
    if (isDuplicate) {
      return res.status(400).json({ success: false, error: `Room "${trimmedRoom}" already exists in this department.` });
    }

    const newRoom = {
      roomNumber: trimmedRoom,
      name: name ? String(name).trim() : `Room ${trimmedRoom}`,
      isActive: true
    };

    dept.rooms.push(newRoom);
    if (!dept.roomNumber) {
      dept.roomNumber = trimmedRoom;
    }
    await dept.save();

    const createdRoom = dept.rooms[dept.rooms.length - 1];
    res.status(201).json({ success: true, room: createdRoom, rooms: dept.rooms });
  } catch (err) {
    console.error('Error in POST /departments/:id/rooms:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/v1/departments/:id/rooms/:roomId - Edit room details (Admin/Supervisor only)
router.patch('/:id/rooms/:roomId', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { id, roomId } = req.params;
    const { roomNumber, name, isActive } = req.body;

    if (!isValidObjectId(id)) return res.status(400).json({ success: false, error: 'Invalid department ID' });

    const dept = await Department.findById(id);
    if (!dept) return res.status(404).json({ success: false, error: 'Department not found' });

    const room = dept.rooms.id(roomId);
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    if (roomNumber !== undefined && String(roomNumber).trim()) {
      const trimmedRoom = String(roomNumber).trim();
      const isDuplicate = (dept.rooms || []).some(
        r => r._id.toString() !== roomId && r.roomNumber.toLowerCase() === trimmedRoom.toLowerCase()
      );
      if (isDuplicate) {
        return res.status(400).json({ success: false, error: `Room "${trimmedRoom}" already exists in this department.` });
      }

      // Cascade update to counters in this department sharing the old roomNumber
      const oldRoomNumber = room.roomNumber;
      room.roomNumber = trimmedRoom;
      if (oldRoomNumber && oldRoomNumber !== trimmedRoom) {
        await Counter.updateMany(
          { departmentId: id, roomNumber: oldRoomNumber },
          { $set: { roomNumber: trimmedRoom } }
        );
      }
    }

    if (name !== undefined) room.name = String(name).trim();
    if (isActive !== undefined) room.isActive = Boolean(isActive);

    await dept.save();
    res.json({ success: true, room, rooms: dept.rooms });
  } catch (err) {
    console.error('Error in PATCH /departments/:id/rooms/:roomId:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/v1/departments/:id/rooms/:roomId - Safely remove a room (Admin/Supervisor only)
router.delete('/:id/rooms/:roomId', requireAuth, checkRole(['master_admin', 'supervisor', 'org_admin']), async (req, res) => {
  try {
    const { id, roomId } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ success: false, error: 'Invalid department ID' });

    const dept = await Department.findById(id);
    if (!dept) return res.status(404).json({ success: false, error: 'Department not found' });

    const room = dept.rooms.id(roomId);
    if (!room) return res.status(404).json({ success: false, error: 'Room not found' });

    // Safety check 1: Active counters in this department assigned to this room
    const activeCounters = await Counter.countDocuments({
      departmentId: id,
      roomNumber: room.roomNumber,
      isActive: true
    });
    if (activeCounters > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete room: ${activeCounters} active counter(s) are currently assigned to Room ${room.roomNumber}. Please reassign or deactivate those counters first.`
      });
    }

    // Safety check 2: Active tickets currently being served in this room
    const activeTickets = await Ticket.countDocuments({
      currentDepartmentId: id,
      roomNumber: room.roomNumber,
      status: { $in: ['SERVING', 'CALLED'] }
    });
    if (activeTickets > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete room: Tickets are currently actively being served in Room ${room.roomNumber}.`
      });
    }

    dept.rooms.pull({ _id: roomId });
    await dept.save();

    res.json({ success: true, message: `Room ${room.roomNumber} removed successfully.`, rooms: dept.rooms });
  } catch (err) {
    console.error('Error in DELETE /departments/:id/rooms/:roomId:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

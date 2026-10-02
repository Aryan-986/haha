/**
 * socket.js — Singleton Socket.io server instance
 *
 * Usage in server.js:
 *   const { initSocket } = require('./socket');
 *   initSocket(httpServer);
 *
 * Usage in route files:
 *   const { emitQueueEvent } = require('../socket');
 *   emitQueueEvent('queue_updated', { orgId, deptId, event: 'DISPENSE', ticket });
 */

const { Server } = require('socket.io');

let io = null;

/**
 * Initialize Socket.io with the given HTTP server.
 * Must be called once during server startup.
 */
function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  io.on('connection', (socket) => {
    // Client joins org+dept rooms to receive targeted updates
    socket.on('join_room', ({ orgId, deptId }) => {
      if (orgId) socket.join(`org:${orgId}`);
      if (deptId) socket.join(`dept:${deptId}`);
    });

    socket.on('leave_room', ({ orgId, deptId }) => {
      if (orgId) socket.leave(`org:${orgId}`);
      if (deptId) socket.leave(`dept:${deptId}`);
    });

    // Dynamic room subscription switching — leave old rooms and join new ones
    socket.on('switch_scope', ({ oldOrgId, oldDeptId, newOrgId, newDeptId }) => {
      if (oldOrgId) socket.leave(`org:${oldOrgId}`);
      if (oldDeptId) socket.leave(`dept:${oldDeptId}`);
      if (newOrgId) socket.join(`org:${newOrgId}`);
      if (newDeptId) socket.join(`dept:${newDeptId}`);
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

/**
 * Emit a queue event to all clients watching a given org/dept.
 * Safe to call even before initSocket() — emits are silently skipped if io is null.
 *
 * @param {string} event  - Event name, e.g. 'queue_updated', 'TOKEN_CALLED', 'TOKEN_UPDATED'
 * @param {Object} payload - { orgId?, deptId?, event, ticket?, ... }
 */
function emitQueueEvent(event, payload) {
  if (!io) return;
  const { orgId, deptId } = payload;

  // Broadcast to department room first (most specific), then org room
  if (deptId) io.to(`dept:${deptId}`).emit(event, payload);
  if (orgId) io.to(`org:${orgId}`).emit(event, payload);

  // If neither is provided, global broadcast as last resort
  if (!deptId && !orgId) io.emit(event, payload);
}

/**
 * Return the raw io instance (for advanced use).
 */
function getIO() {
  return io;
}

module.exports = { initSocket, emitQueueEvent, getIO };

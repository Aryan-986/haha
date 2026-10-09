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

    // Scoped subscription for citizen ticket tracking
    socket.on('join_ticket', ({ ticketId, trackingToken }) => {
      if (ticketId) socket.join(`ticket:${ticketId}`);
      if (trackingToken) socket.join(`ticket:${trackingToken}`);
    });

    socket.on('leave_ticket', ({ ticketId, trackingToken }) => {
      if (ticketId) socket.leave(`ticket:${ticketId}`);
      if (trackingToken) socket.leave(`ticket:${trackingToken}`);
    });

    socket.on('disconnect', () => {});
  });

  return io;
}

/**
 * Emit a queue event to all clients watching a given org/dept/ticket.
 * Safe to call even before initSocket() — emits are silently skipped if io is null.
 *
 * @param {string} event  - Event name, e.g. 'queue_updated', 'ticket.called', etc.
 * @param {Object} payload - { orgId?, deptId?, event, ticket?, ticketId?, trackingToken? }
 */
function emitQueueEvent(event, payload) {
  if (!io) return;
  const { orgId, deptId, ticket } = payload;
  const ticketId = ticket?._id ? ticket._id.toString() : (payload.ticketId ? payload.ticketId.toString() : null);
  const trackingToken = ticket?.trackingToken || payload.trackingToken;

  // Broadcast to ticket room for authorized/citizen tracking
  if (ticketId) io.to(`ticket:${ticketId}`).emit(event, payload);
  if (trackingToken) io.to(`ticket:${trackingToken}`).emit(event, payload);

  // Broadcast to department room first (most specific), then org room
  if (deptId) io.to(`dept:${deptId}`).emit(event, payload);
  if (orgId) io.to(`org:${orgId}`).emit(event, payload);

  // If none is provided, global broadcast as last resort
  if (!deptId && !orgId && !ticketId && !trackingToken) io.emit(event, payload);
}

/**
 * Return the raw io instance (for advanced use).
 */
function getIO() {
  return io;
}

module.exports = { initSocket, emitQueueEvent, getIO };

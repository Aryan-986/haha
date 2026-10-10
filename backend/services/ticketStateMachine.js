/**
 * ticketStateMachine.js
 * Centralized lifecycle transition engine for QueueLess Tickets
 */

const ALLOWED_TRANSITIONS = {
  WAITING: ['CALLED', 'CANCELLED', 'SNOOZED'],
  CALLED: ['SERVING', 'COMPLETED', 'TRANSFERRED', 'SNOOZED', 'SKIPPED', 'NO_SHOW', 'CANCELLED'],
  SERVING: ['COMPLETED', 'TRANSFERRED', 'SNOOZED'],
  SNOOZED: ['WAITING', 'CALLED', 'CANCELLED'],
  SKIPPED: ['WAITING', 'CANCELLED'],
  TRANSFERRED: ['WAITING', 'CALLED', 'CANCELLED'],
  NO_SHOW: ['WAITING', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: []
};

/**
 * Validates whether transition from fromStatus to toStatus is permitted.
 * @param {string} fromStatus 
 * @param {string} toStatus 
 * @returns {boolean}
 */
function isValidTransition(fromStatus, toStatus) {
  if (!fromStatus || !toStatus) return false;
  if (['COMPLETED', 'CANCELLED'].includes(fromStatus)) return false;
  if (fromStatus === toStatus) return true;
  const allowed = ALLOWED_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
}

/**
 * Asserts valid transition, throws Error if invalid.
 * @param {string} fromStatus 
 * @param {string} toStatus 
 */
function assertValidTransition(fromStatus, toStatus) {
  if (!isValidTransition(fromStatus, toStatus)) {
    const error = new Error(`Invalid ticket state transition from '${fromStatus}' to '${toStatus}'`);
    error.status = 400;
    error.code = 'INVALID_STATE_TRANSITION';
    throw error;
  }
}

module.exports = {
  ALLOWED_TRANSITIONS,
  isValidTransition,
  assertValidTransition
};

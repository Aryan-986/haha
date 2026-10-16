/**
 * AuditLog.js
 * Immutable audit trail for administrative actions in QueueLess.
 * Records who did what, when, to whom, and the before/after state.
 */

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  // Who performed the action (Clerk userId)
  actorId: {
    type: String,
    required: true,
    index: true
  },
  actorEmail: {
    type: String,
    default: ''
  },
  // What action was performed
  action: {
    type: String,
    required: true,
    enum: [
      'ACCESS_REQUEST_SUBMITTED',
      'ACCESS_REQUEST_APPROVED',
      'ACCESS_REQUEST_REJECTED',
      'ACCESS_REQUEST_CANCELLED',
      'STAFF_CREATED',
      'STAFF_ROLE_CHANGED',
      'STAFF_DEACTIVATED',
      'STAFF_REACTIVATED',
      'STAFF_SCOPE_CHANGED',
      'STAFF_MEMBERSHIP_REVOKED',
      'ORGANIZATION_CREATED',
      'ORGANIZATION_UPDATED',
      'ORGANIZATION_ARCHIVED',
      'DEPARTMENT_CREATED',
      'COUNTER_CREATED',
      'MASTER_ADMIN_BOOTSTRAPPED'
    ],
    index: true
  },
  // Who/what was acted upon
  targetType: {
    type: String,
    enum: ['USER', 'ORGANIZATION', 'DEPARTMENT', 'COUNTER', 'ACCESS_REQUEST', 'WORKER'],
    default: 'USER'
  },
  targetId: {
    type: String,
    default: null,
    index: true
  },
  // Organization context
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true
  },
  // Details of the change
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  // IP address (optional, for security auditing)
  ipAddress: {
    type: String,
    default: null
  }
}, {
  timestamps: true
});

// Efficient chronological queries
auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema);

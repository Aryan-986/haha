const mongoose = require('mongoose');
const crypto = require('crypto');

const departmentTransitionSchema = new mongoose.Schema({
  deptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  servedBy: {
    type: String,
    default: null
  },
  counterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Counter',
    default: null
  },
  action: {
    type: String,
    default: 'TRANSITION'
  }
}, { _id: false });

const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true,
    index: true
  },
  trackingToken: {
    type: String,
    unique: true,
    sparse: true,
    default: () => crypto.randomBytes(16).toString('hex'),
    index: true
  },
  idempotencyKey: {
    type: String,
    sparse: true,
    index: true
  },
  source: {
    type: String,
    enum: ['KIOSK', 'WEB', 'MOBILE', 'WALK_IN'],
    default: 'WEB'
  },
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  currentDepartmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true,
    index: true
  },
  currentCounterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Counter',
    default: null,
    index: true
  },
  currentWorkerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null
  },
  currentServiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    default: null
  },
  targetRoomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true
  },
  roomNumber: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  counterNumber: {
    type: Number,
    default: 1
  },
  status: {
    type: String,
    enum: [
      'WAITING',
      'CALLED',
      'SERVING',
      'SNOOZED',
      'SKIPPED',
      'TRANSFERRED',
      'COMPLETED',
      'NO_SHOW',
      'CANCELLED'
    ],
    default: 'WAITING',
    index: true
  },
  priority: {
    type: String,
    enum: ['NORMAL', 'URGENT', 'EMERGENCY'],
    default: 'NORMAL',
    index: true
  },
  priorityWeight: {
    type: Number,
    default: 1,
    index: true
  },
  position: {
    type: Number,
    default: 1
  },
  calledAt: {
    type: Date,
    default: null
  },
  serviceStartedAt: {
    type: Date,
    default: null
  },
  completedAt: {
    type: Date,
    default: null
  },
  snoozeInfo: {
    snoozedAt: { type: Date, default: null },
    snoozeCount: { type: Number, default: 0 },
    resumePosition: { type: Number, default: 0 },
    resumeAt: { type: Date, default: null, index: true },
    source: { type: String, default: 'WORKER' },
    isSnoozed: { type: Boolean, default: false }
  },
  transferInfo: {
    fromDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    toDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    transferredBy: { type: String, default: null },
    transferredAt: { type: Date, default: null }
  },
  history: {
    type: [departmentTransitionSchema],
    default: []
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Backward-compatible aliases for legacy callers
ticketSchema.virtual('orgId')
  .get(function() { return this.organizationId; })
  .set(function(v) { this.organizationId = v; });

ticketSchema.virtual('currentDeptId')
  .get(function() { return this.currentDepartmentId; })
  .set(function(v) { this.currentDepartmentId = v; });

ticketSchema.virtual('serviceId')
  .get(function() { return this.currentServiceId; })
  .set(function(v) { this.currentServiceId = v; });

ticketSchema.virtual('positionInQueue')
  .get(function() { return this.position; })
  .set(function(v) { this.position = v; });

// Pre-save hook to ensure priorityWeight is in sync
ticketSchema.pre('save', function() {
  if (this.priority === 'EMERGENCY') this.priorityWeight = 3;
  else if (this.priority === 'URGENT') this.priorityWeight = 2;
  else this.priorityWeight = 1;
});

// Composite indexes for queue ordering queries (organization + department + status + priority)
ticketSchema.index({ organizationId: 1, currentDepartmentId: 1, status: 1, priorityWeight: -1, createdAt: 1 });
ticketSchema.index({ organizationId: 1, currentDepartmentId: 1, status: 1, priority: -1, createdAt: 1 });
ticketSchema.index({ organizationId: 1, currentDepartmentId: 1, status: 1 });
ticketSchema.index({ organizationId: 1, status: 1 });
ticketSchema.index({ 'snoozeInfo.resumeAt': 1, status: 1 });

module.exports = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
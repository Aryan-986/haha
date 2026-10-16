/**
 * AccessRequest.js
 * Model for staff access requests to QueueLess organizations.
 * 
 * Workflow:
 * 1. User authenticates via Clerk
 * 2. Submits request with desired org + role
 * 3. Master Admin reviews and approves/rejects
 * 4. On approval, a Worker record is created with proper permissions
 */

const mongoose = require('mongoose');

const accessRequestSchema = new mongoose.Schema({
  // Clerk user identity (immutable after creation)
  clerkUserId: {
    type: String,
    required: true,
    index: true
  },
  // Applicant information captured at request time
  applicantName: {
    type: String,
    required: true,
    trim: true
  },
  applicantEmail: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  // The organization they want to join
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  // The role they are requesting
  requestedRole: {
    type: String,
    enum: ['WORKER', 'SUPERVISOR'],
    required: true
  },
  // Optional message from the applicant
  message: {
    type: String,
    trim: true,
    default: '',
    maxlength: 500
  },
  // Request lifecycle status
  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'],
    default: 'PENDING',
    index: true
  },
  // Rejection reason (set by admin)
  rejectionReason: {
    type: String,
    trim: true,
    default: ''
  },
  // Approval details (set by admin during approval)
  approvalDetails: {
    approvedRole: { type: String, default: null },
    approvedOrganizationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', default: null },
    approvedDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    approvedCounterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Counter', default: null },
    approvedBy: { type: String, default: null }, // Clerk userId of approving admin
    approvedAt: { type: Date, default: null }
  },
  // The Worker record created on approval
  resultingWorkerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null
  },
  // Processing metadata
  processedBy: {
    type: String,
    default: null // Clerk userId of the admin who processed this
  },
  processedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Prevent duplicate active requests: same user + same org + same role + PENDING status
accessRequestSchema.index(
  { clerkUserId: 1, organizationId: 1, requestedRole: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'PENDING' }
  }
);

// Efficient queries for admin dashboard
accessRequestSchema.index({ status: 1, createdAt: -1 });
accessRequestSchema.index({ organizationId: 1, status: 1 });

module.exports = mongoose.models.AccessRequest || mongoose.model('AccessRequest', accessRequestSchema);

const mongoose = require('mongoose');

const queueEventSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  ticketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    required: true,
    index: true
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true,
    index: true
  },
  workerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null
  },
  counterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Counter',
    default: null
  },
  eventType: {
    type: String,
    enum: [
      'TICKET_CREATED',
      'TICKET_CALLED',
      'SERVICE_STARTED',
      'SERVICE_COMPLETED',
      'TICKET_TRANSFERRED',
      'TICKET_SNOOZED',
      'TICKET_RESUMED',
      'TICKET_SKIPPED',
      'TICKET_RECALLED',
      'TICKET_NO_SHOW',
      'TICKET_CANCELLED'
    ],
    required: true,
    index: true
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  }
}, { timestamps: true });

module.exports = mongoose.models.QueueEvent || mongoose.model('QueueEvent', queueEventSchema);

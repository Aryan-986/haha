const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true,
    index: true
  },
  counterNumber: {
    type: Number,
    required: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  status: {
    type: String,
    enum: ['AVAILABLE', 'BUSY', 'OFFLINE', 'PAUSED'],
    default: 'AVAILABLE',
    index: true
  },
  assignedWorkerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Worker',
    default: null
  },
  currentTicketId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ticket',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

counterSchema.index({ departmentId: 1, counterNumber: 1 }, { unique: true });

module.exports = mongoose.models.Counter || mongoose.model('Counter', counterSchema);

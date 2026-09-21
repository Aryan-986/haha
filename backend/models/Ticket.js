const mongoose = require('mongoose');

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
  }
}, { _id: false });

const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true
  },
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    index: true
  },
  currentDeptId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    index: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: false
  },
  history: {
    type: [departmentTransitionSchema],
    default: []
  },
  status: {
    type: String,
    enum: ['WAITING', 'IN_SERVICE', 'TRANSFERRED', 'COMPLETED', 'CANCELLED'],
    default: 'WAITING',
    index: true
  },
  positionInQueue: {
    type: Number,
    default: 1
  }
}, { timestamps: true });

module.exports = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
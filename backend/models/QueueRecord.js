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

const queueRecordSchema = new mongoose.Schema({
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
  status: {
    type: String,
    enum: ['WAITING', 'IN_SERVICE', 'TRANSFERRED', 'COMPLETED', 'CANCELLED'],
    default: 'WAITING'
  },
  history: {
    type: [departmentTransitionSchema],
    default: []
  },
  hour: {
    type: Number
  },
  dayOfWeek: {
    type: Number
  },
  recordedQueue: {
    type: Number
  },
  activeCounters: {
    type: Number
  }
}, { timestamps: true });

module.exports = mongoose.models.QueueRecord || mongoose.model('QueueRecord', queueRecordSchema);
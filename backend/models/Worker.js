const mongoose = require('mongoose');

const workerSchema = new mongoose.Schema({
  organizationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null,
    index: true
  },
  counterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Counter',
    default: null
  },
  authUserId: {
    type: String,
    sparse: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  role: {
    type: String,
    enum: ['WORKER', 'SUPERVISOR', 'ORG_ADMIN', 'MASTER_ADMIN'],
    default: 'WORKER'
  },
  status: {
    type: String,
    enum: ['AVAILABLE', 'BUSY', 'OFFLINE', 'ON_BREAK'],
    default: 'AVAILABLE',
    index: true
  },
  permissions: {
    type: [String],
    default: ['QUEUE_OPERATE']
  }
}, { timestamps: true });

module.exports = mongoose.models.Worker || mongoose.model('Worker', workerSchema);

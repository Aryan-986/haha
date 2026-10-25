const mongoose = require('mongoose');

const roomSubSchema = new mongoose.Schema({
  roomNumber: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

const departmentSchema = new mongoose.Schema({
  orgId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Organization',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  prefix: {
    type: String,
    required: true,
    uppercase: true,
    trim: true
  },
  roomNumber: {
    type: String,
    trim: true,
    default: '',
    index: true
  },
  rooms: {
    type: [roomSubSchema],
    default: []
  },
  avgServiceTimeMins: {
    type: Number,
    default: 5,
    min: 1
  },
  subCounters: {
    type: [String],
    default: []
  },
  isEntryLevel: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

module.exports = mongoose.models.Department || mongoose.model('Department', departmentSchema);

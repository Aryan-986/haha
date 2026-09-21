const mongoose = require('mongoose');
const crypto = require('crypto');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  type: {
    type: String,
    required: true,
    enum: ['HOSPITAL', 'GOVERNMENT', 'PRIVATE'],
    default: 'GOVERNMENT'
  },
  address: {
    type: String,
    trim: true,
    default: ''
  },
  apiKey: {
    type: String,
    unique: true,
    sparse: true,
    default: () => crypto.randomBytes(16).toString('hex')
  },
  status: {
    type: String,
    enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
    default: 'ACTIVE'
  }
}, { timestamps: true });

module.exports = mongoose.models.Organization || mongoose.model('Organization', organizationSchema);

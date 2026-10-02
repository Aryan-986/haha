const mongoose = require('mongoose');

const ticketSequenceSchema = new mongoose.Schema({
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
  prefix: {
    type: String,
    required: true,
    uppercase: true
  },
  dateStr: {
    type: String,
    required: true
  },
  seq: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

ticketSequenceSchema.index({ organizationId: 1, departmentId: 1, dateStr: 1 }, { unique: true });

module.exports = mongoose.models.TicketSequence || mongoose.model('TicketSequence', ticketSequenceSchema);

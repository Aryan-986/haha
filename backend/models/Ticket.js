const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  ticketNumber: {
    type: String,
    required: true
  },
  serviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  status: {
    type: String,
    enum: ['WAITING', 'COMPLETED', 'CANCELLED'],
    default: 'WAITING'
  },
  positionInQueue: {
    type: Number,
    default: 1
  }
}, { timestamps: true });

module.exports = mongoose.model('Ticket', ticketSchema);
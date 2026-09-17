const mongoose = require('mongoose');

const queueRecordSchema = new mongoose.Schema({
  serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  hour: { type: Number, required: true },
  dayOfWeek: { type: Number, required: true },
  recordedQueue: { type: Number, required: true },
  activeCounters: { type: Number, required: true }
}, { timestamps: true });

module.exports = mongoose.model('QueueRecord', queueRecordSchema);
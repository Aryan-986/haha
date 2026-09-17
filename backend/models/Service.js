const mongoose = require('mongoose');

const serviceSchema = new mongoose.Schema({
  office: { 
    type: String, 
    required: true 
  },
  name: { 
    type: String, 
    required: true 
  },
  currentlyServingNumber: { 
    type: Number, 
    default: 100 
  },
  currentQueueCount: { 
    type: Number, 
    default: 0 
  },
  activeCounters: { 
    type: Number, 
    default: 1 
  },
  avgServiceTimeMin: { 
    type: Number, 
    default: 3 
  },
  estimatedWaitMin: { 
    type: Number, 
    default: 0 
  },
  crowdLevel: { 
    type: String, 
    default: 'LOW CROWD' 
  },
  requiredDocuments: { 
    type: [String], 
    default: [] 
  }
}, { timestamps: true });

module.exports = mongoose.models.Service || mongoose.model('Service', serviceSchema);
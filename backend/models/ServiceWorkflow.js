const mongoose = require('mongoose');

const workflowStageSchema = new mongoose.Schema({
  departmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  name: {
    type: String,
    trim: true,
    default: ''
  },
  order: {
    type: Number,
    required: true
  },
  isOptional: {
    type: Boolean,
    default: false
  },
  allowedNextDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  }]
}, { _id: false });

const serviceWorkflowSchema = new mongoose.Schema({
  organizationId: {
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
  description: {
    type: String,
    trim: true,
    default: ''
  },
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  entryDepartmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true
  },
  stages: {
    type: [workflowStageSchema],
    default: []
  }
}, { timestamps: true });

serviceWorkflowSchema.index({ organizationId: 1, isActive: 1 });

module.exports = mongoose.models.ServiceWorkflow || mongoose.model('ServiceWorkflow', serviceWorkflowSchema);

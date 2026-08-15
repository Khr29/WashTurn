const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
    turnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turn', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['RELEASED', 'CLAIMED', 'STARTED', 'COMPLETED', 'EXPIRED'],
      required: true,
    },
    summary: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

activityLogSchema.index({ householdId: 1, timestamp: -1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);

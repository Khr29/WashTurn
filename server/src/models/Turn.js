const mongoose = require('mongoose');

const TURN_STATUSES = ['PENDING', 'RELEASED', 'CLAIMED', 'IN_USE', 'COMPLETED', 'EXPIRED'];
const TURN_TYPES = ['NORMAL', 'EMERGENCY'];

const turnSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
    date: { type: String, required: true }, // household-local calendar date, "YYYY-MM-DD"
    scheduledUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actingUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: TURN_TYPES, default: null },
    status: { type: String, enum: TURN_STATUSES, default: 'PENDING' },
    estimatedDurationMinutes: { type: Number, default: null },
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One turn per household per calendar day.
turnSchema.index({ householdId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('Turn', turnSchema);
module.exports.TURN_STATUSES = TURN_STATUSES;
module.exports.TURN_TYPES = TURN_TYPES;

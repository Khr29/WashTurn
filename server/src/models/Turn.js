const mongoose = require('mongoose');

const TURN_STATUSES = ['PENDING', 'RELEASED', 'CLAIMED', 'IN_USE', 'COMPLETED', 'EXPIRED'];
const TURN_TYPES = ['NORMAL', 'EMERGENCY'];
const OPEN_TURN_STATUSES = ['PENDING', 'RELEASED', 'CLAIMED', 'IN_USE'];
const TERMINAL_TURN_STATUSES = ['COMPLETED', 'EXPIRED'];

const turnSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
    date: { type: String, required: true }, // household-local calendar date, "YYYY-MM-DD"
    // The current owner of this turn — who it's "for". Seeded from the weekly
    // Schedule when the turn is created, but reassignable afterward via a
    // direct transfer or an accepted TurnRequest (see turn.service.js). The
    // field name predates that and still reflects the schedule-assigned
    // owner in the common case, but it is not immutable.
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

// A household can have any number of turns on the same calendar day (e.g. one
// person washing twice), but only one of them may be "open" (not yet
// finished) at a time — that's what keeps the single physical machine's
// state unambiguous. This partial unique index enforces exactly that: at
// most one PENDING/RELEASED/CLAIMED/IN_USE turn per (householdId, date), with
// no limit on how many COMPLETED/EXPIRED turns share that same date.
turnSchema.index(
  { householdId: 1, date: 1 },
  { unique: true, partialFilterExpression: { status: { $in: OPEN_TURN_STATUSES } } }
);

module.exports = mongoose.model('Turn', turnSchema);
module.exports.TURN_STATUSES = TURN_STATUSES;
module.exports.TURN_TYPES = TURN_TYPES;
module.exports.OPEN_TURN_STATUSES = OPEN_TURN_STATUSES;
module.exports.TERMINAL_TURN_STATUSES = TERMINAL_TURN_STATUSES;

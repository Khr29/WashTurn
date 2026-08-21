const mongoose = require('mongoose');

const TURN_STATUSES = ['PENDING', 'RELEASED', 'CLAIMED', 'IN_USE', 'COMPLETED', 'EXPIRED'];
const TURN_TYPES = ['NORMAL', 'EMERGENCY'];
const OPEN_TURN_STATUSES = ['PENDING', 'RELEASED', 'CLAIMED', 'IN_USE'];
const TERMINAL_TURN_STATUSES = ['COMPLETED', 'EXPIRED'];

const turnSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
    machineId: { type: mongoose.Schema.Types.ObjectId, ref: 'Machine', required: true },
    // Household-local calendar date the slot *starts* on, "YYYY-MM-DD" —
    // informational only now (dayOfWeek lookups, display), never used for
    // uniqueness or "is this turn still current" — that's startAt/endAt's job.
    date: { type: String, required: true },
    // The real instants this turn's owner has the machine for. A slot can
    // cross midnight and span multiple calendar days (endAt > startAt by more
    // than 24h is not assumed anywhere) — these two fields, not `date`, are
    // the single source of truth for whether a turn is currently active.
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    // The current owner of this turn — who it's "for". Seeded from the weekly
    // Schedule when the turn is created, but reassignable afterward via a
    // direct transfer, an accepted TurnRequest, or an emergency claim (see
    // turn.service.js). The field name predates that and still reflects the
    // schedule-assigned owner in the common case, but it is not immutable.
    scheduledUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    actingUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    type: { type: String, enum: TURN_TYPES, default: null },
    status: { type: String, enum: TURN_STATUSES, default: 'PENDING' },
    estimatedDurationMinutes: { type: Number, default: null },
    // Most recent wash's start/finish within this slot — a slot can contain
    // any number of washes (see turn.service.js), so these describe the
    // latest one, not "the" wash. Once non-null, startedAt never resets back
    // to null for the life of the slot — it's how finalization tells
    // COMPLETED (used at least once) apart from EXPIRED (never used).
    startedAt: { type: Date, default: null },
    finishedAt: { type: Date, default: null },
    releasedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// A household owns exactly one physical machine, so at most one turn may be
// "open" (its slot hasn't been finalized yet) at a time, full stop — no
// longer scoped by date, since a single slot can itself span more than one
// calendar date. This partial unique index enforces exactly that: at most one
// PENDING/RELEASED/CLAIMED/IN_USE turn per household, with no limit on how
// many COMPLETED/EXPIRED turns a household accumulates over time.
turnSchema.index(
  { householdId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: OPEN_TURN_STATUSES } } }
);

module.exports = mongoose.model('Turn', turnSchema);
module.exports.TURN_STATUSES = TURN_STATUSES;
module.exports.TURN_TYPES = TURN_TYPES;
module.exports.OPEN_TURN_STATUSES = OPEN_TURN_STATUSES;
module.exports.TERMINAL_TURN_STATUSES = TERMINAL_TURN_STATUSES;

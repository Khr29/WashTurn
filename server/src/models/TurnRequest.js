const mongoose = require('mongoose');

const REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED'];

const turnRequestSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
    turnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turn', required: true },
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: REQUEST_STATUSES, default: 'PENDING' },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

turnRequestSchema.index({ turnId: 1, status: 1 });

// A user may have only one PENDING request open on a given turn at a time —
// they can request again after a prior request was rejected/cancelled/accepted,
// since those don't match this partial filter.
turnRequestSchema.index(
  { turnId: 1, requesterId: 1 },
  { unique: true, partialFilterExpression: { status: 'PENDING' } }
);

module.exports = mongoose.model('TurnRequest', turnRequestSchema);
module.exports.REQUEST_STATUSES = REQUEST_STATUSES;

const mongoose = require('mongoose');

const DRYING_REQUEST_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED'];

const dryingRequestSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true },
    // Optional link to the wash turn that produced the clothes. Drying is a
    // separate responsibility from the machine lifecycle (see drying.service.js) —
    // this is informational only and never gates any drying transition.
    turnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turn', default: null },
    requesterId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // clothes owner
    helperId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // requested helper
    status: { type: String, enum: DRYING_REQUEST_STATUSES, default: 'PENDING' },
    acceptedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
  },
  { timestamps: true }
);

dryingRequestSchema.index({ householdId: 1, status: 1 });
dryingRequestSchema.index({ helperId: 1, status: 1 });
dryingRequestSchema.index({ requesterId: 1, status: 1 });

// At most one active (PENDING/ACCEPTED) drying request per (requester, helper,
// turn). A task is identified by the wash turn it's associated with, or — for
// ad hoc requests with no turn — by the (requester, helper) pair itself: Mongo's
// partial index treats null turnId as an equal value across documents, so a
// second ad hoc request between the same pair can't be created while one is
// already active. Once a request leaves PENDING/ACCEPTED it drops out of this
// partial filter, so a brand new request for a later task is never blocked.
dryingRequestSchema.index(
  { requesterId: 1, helperId: 1, turnId: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['PENDING', 'ACCEPTED'] } } }
);

module.exports = mongoose.model('DryingRequest', dryingRequestSchema);
module.exports.DRYING_REQUEST_STATUSES = DRYING_REQUEST_STATUSES;

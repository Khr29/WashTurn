const mongoose = require('mongoose');

const MACHINE_STATUSES = ['AVAILABLE', 'IN_USE', 'RELEASED', 'COMPLETED'];

const machineSchema = new mongoose.Schema(
  {
    householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household', required: true, unique: true },
    status: { type: String, enum: MACHINE_STATUSES, default: 'AVAILABLE' },
    currentTurnId: { type: mongoose.Schema.Types.ObjectId, ref: 'Turn', default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Machine', machineSchema);
module.exports.MACHINE_STATUSES = MACHINE_STATUSES;

const Machine = require('../models/Machine');

async function getMachine(householdId) {
  return Machine.findOne({ householdId });
}

// Machine.status/currentTurnId is a coarse read-model mirroring the just-committed
// Turn transition. It is never the source of truth for whether an action is allowed —
// the atomic conditional updates on Turn are — so a plain $set here is safe.
async function syncMachineFromTurn(householdId, turn) {
  const statusMap = {
    PENDING: 'AVAILABLE',
    RELEASED: 'RELEASED',
    CLAIMED: 'RELEASED',
    IN_USE: 'IN_USE',
    COMPLETED: 'COMPLETED',
    EXPIRED: 'AVAILABLE',
  };

  return Machine.findOneAndUpdate(
    { householdId },
    { $set: { status: statusMap[turn.status], currentTurnId: turn._id } },
    { new: true }
  );
}

module.exports = { getMachine, syncMachineFromTurn };

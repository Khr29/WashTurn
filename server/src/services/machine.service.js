const Machine = require('../models/Machine');
const { ApiError } = require('../utils/ApiError');

const STATUS_FROM_TURN_STATUS = {
  PENDING: 'AVAILABLE',
  RELEASED: 'RELEASED',
  CLAIMED: 'RELEASED',
  IN_USE: 'IN_USE',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'AVAILABLE',
};

// Machine.status is never independently authoritative — it's always derived
// from the household's current-day Turn, which is the single source of
// truth for machine/turn state. Deriving it on every read (rather than
// persisting a copy kept in sync alongside each Turn write) makes it
// impossible for Machine and Turn to contradict each other, even if a
// request crashes between updating the Turn and updating the Machine.
async function getMachineForTurn(householdId, turn) {
  const machine = await Machine.findOne({ householdId });
  if (!machine) {
    throw new ApiError(500, 'Household is missing its machine record.');
  }

  return {
    _id: machine._id,
    householdId: machine.householdId,
    status: STATUS_FROM_TURN_STATUS[turn.status],
    currentTurnId: turn._id,
    createdAt: machine.createdAt,
    updatedAt: machine.updatedAt,
  };
}

module.exports = { getMachineForTurn, STATUS_FROM_TURN_STATUS };

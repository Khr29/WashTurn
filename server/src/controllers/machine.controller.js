const { asyncHandler } = require('../utils/asyncHandler');
const machineService = require('../services/machine.service');
const turnService = require('../services/turn.service');

const getMachine = asyncHandler(async (req, res) => {
  const turn = await turnService.getCurrentTurn(req.household);
  const machine = await machineService.getMachineForTurn(req.household._id, turn);
  res.json({ machine });
});

const getTodayTurn = asyncHandler(async (req, res) => {
  const turn = await turnService.getCurrentTurn(req.household);
  res.json({ turn });
});

module.exports = { getMachine, getTodayTurn };

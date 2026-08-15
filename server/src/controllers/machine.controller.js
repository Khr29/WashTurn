const { asyncHandler } = require('../utils/asyncHandler');
const machineService = require('../services/machine.service');
const turnService = require('../services/turn.service');

const getMachine = asyncHandler(async (req, res) => {
  const machine = await machineService.getMachine(req.household._id);
  res.json({ machine });
});

const getTodayTurn = asyncHandler(async (req, res) => {
  const turn = await turnService.getOrCreateTodayTurn(req.household);
  res.json({ turn });
});

module.exports = { getMachine, getTodayTurn };

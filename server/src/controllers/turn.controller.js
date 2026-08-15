const { asyncHandler } = require('../utils/asyncHandler');
const turnService = require('../services/turn.service');

const start = asyncHandler(async (req, res) => {
  const { estimatedDurationMinutes } = req.body;
  const turn = await turnService.startTurn(req.params.id, req.user.id, { estimatedDurationMinutes });
  res.json({ turn });
});

const release = asyncHandler(async (req, res) => {
  const turn = await turnService.releaseTurn(req.params.id, req.user.id);
  res.json({ turn });
});

const claim = asyncHandler(async (req, res) => {
  const turn = await turnService.claimTurn(req.params.id, req.user.id);
  res.json({ turn });
});

const finish = asyncHandler(async (req, res) => {
  const turn = await turnService.finishTurn(req.params.id, req.user.id);
  res.json({ turn });
});

module.exports = { start, release, claim, finish };

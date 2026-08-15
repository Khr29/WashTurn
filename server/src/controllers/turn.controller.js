const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const turnService = require('../services/turn.service');

// A wash cycle is realistically somewhere between a few minutes and a few
// hours — this is just a sanity bound, not a physical machine limit.
const MIN_DURATION_MINUTES = 1;
const MAX_DURATION_MINUTES = 240;

const start = asyncHandler(async (req, res) => {
  const { estimatedDurationMinutes } = req.body;

  if (estimatedDurationMinutes !== undefined && estimatedDurationMinutes !== null) {
    if (
      typeof estimatedDurationMinutes !== 'number' ||
      !Number.isInteger(estimatedDurationMinutes) ||
      estimatedDurationMinutes < MIN_DURATION_MINUTES ||
      estimatedDurationMinutes > MAX_DURATION_MINUTES
    ) {
      throw new ApiError(
        400,
        `estimatedDurationMinutes must be a whole number between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES}.`
      );
    }
  }

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

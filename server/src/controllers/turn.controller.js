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

const transfer = asyncHandler(async (req, res) => {
  const { toUserId } = req.body;
  if (!toUserId) throw new ApiError(400, 'toUserId is required.');

  const turn = await turnService.transferTurn(req.params.id, req.user.id, toUserId);
  res.json({ turn });
});

const createRequest = asyncHandler(async (req, res) => {
  const request = await turnService.createTurnRequest(req.params.id, req.user.id);
  res.status(201).json({ request });
});

const listRequests = asyncHandler(async (req, res) => {
  const requests = await turnService.listTurnRequests(req.params.id);
  res.json({ requests });
});

const acceptRequest = asyncHandler(async (req, res) => {
  const { turn, request } = await turnService.acceptTurnRequest(req.params.id, req.params.requestId, req.user.id);
  res.json({ turn, request });
});

const rejectRequest = asyncHandler(async (req, res) => {
  const request = await turnService.rejectTurnRequest(req.params.id, req.params.requestId, req.user.id);
  res.json({ request });
});

const cancelRequest = asyncHandler(async (req, res) => {
  const request = await turnService.cancelTurnRequest(req.params.id, req.params.requestId, req.user.id);
  res.json({ request });
});

module.exports = {
  start,
  release,
  claim,
  finish,
  transfer,
  createRequest,
  listRequests,
  acceptRequest,
  rejectRequest,
  cancelRequest,
};

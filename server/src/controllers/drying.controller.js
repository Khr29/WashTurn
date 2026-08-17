const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const dryingService = require('../services/drying.service');

const create = asyncHandler(async (req, res) => {
  const { householdId, helperId, turnId } = req.body;
  if (!householdId) throw new ApiError(400, 'householdId is required.');
  if (!helperId) throw new ApiError(400, 'helperId is required.');

  const request = await dryingService.createDryingRequest(householdId, req.user.id, helperId, turnId || null);
  res.status(201).json({ request });
});

const list = asyncHandler(async (req, res) => {
  const { householdId, scope } = req.query;
  const requests = await dryingService.listDryingRequests(householdId, req.user.id, scope);
  res.json({ requests });
});

const balances = asyncHandler(async (req, res) => {
  const { householdId } = req.query;
  const favorBalances = await dryingService.getFavorBalances(householdId, req.user.id);
  res.json({ balances: favorBalances });
});

const accept = asyncHandler(async (req, res) => {
  const request = await dryingService.acceptDryingRequest(req.params.id, req.user.id);
  res.json({ request });
});

const reject = asyncHandler(async (req, res) => {
  const request = await dryingService.rejectDryingRequest(req.params.id, req.user.id);
  res.json({ request });
});

const cancel = asyncHandler(async (req, res) => {
  const request = await dryingService.cancelDryingRequest(req.params.id, req.user.id);
  res.json({ request });
});

const complete = asyncHandler(async (req, res) => {
  const request = await dryingService.completeDryingRequest(req.params.id, req.user.id);
  res.json({ request });
});

module.exports = { create, list, balances, accept, reject, cancel, complete };

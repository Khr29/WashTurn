const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const householdService = require('../services/household.service');

const create = asyncHandler(async (req, res) => {
  const { name, timezone } = req.body;
  if (!name) throw new ApiError(400, 'name is required.');

  const household = await householdService.createHousehold({ name, ownerId: req.user.id, timezone });
  res.status(201).json({ household });
});

const join = asyncHandler(async (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) throw new ApiError(400, 'inviteCode is required.');

  const household = await householdService.joinHousehold({ inviteCode, userId: req.user.id });
  res.json({ household });
});

const getOne = asyncHandler(async (req, res) => {
  res.json({ household: req.household });
});

const getMembers = asyncHandler(async (req, res) => {
  const members = await householdService.getMembers(req.household);
  res.json({ members });
});

const removeMember = asyncHandler(async (req, res) => {
  const household = await householdService.removeMember(req.household, req.params.userId);
  res.json({ household });
});

module.exports = { create, join, getOne, getMembers, removeMember };

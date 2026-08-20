const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../utils/ApiError');
const householdService = require('../services/household.service');

const create = asyncHandler(async (req, res) => {
  const { name, timezone } = req.body;
  if (typeof name !== 'string' || !name) throw new ApiError(400, 'name is required.');
  if (timezone !== undefined && typeof timezone !== 'string') {
    throw new ApiError(400, 'timezone must be a string.');
  }

  const household = await householdService.createHousehold({ name, ownerId: req.user.id, timezone });
  res.status(201).json({ household });
});

const join = asyncHandler(async (req, res) => {
  const { inviteCode } = req.body;
  // Type-checked, not just truthiness — inviteCode.toUpperCase() in the
  // service would otherwise throw a raw TypeError (500) for a non-string
  // body value like an object, array, or number.
  if (typeof inviteCode !== 'string' || !inviteCode) throw new ApiError(400, 'inviteCode is required.');

  const household = await householdService.joinHousehold({ inviteCode, userId: req.user.id });
  res.json({ household });
});

const getOne = asyncHandler(async (req, res) => {
  res.json({ household: req.household });
});

// Not gated by requireHouseholdMember — the caller doesn't know a household
// id to check membership against yet, that's the whole point of this route.
// `household: null` (not a 404) is the normal, valid response for a user who
// genuinely doesn't belong to one yet.
const getMine = asyncHandler(async (req, res) => {
  const household = await householdService.findMyHousehold(req.user.id);
  res.json({ household });
});

const getMembers = asyncHandler(async (req, res) => {
  const members = await householdService.getMembers(req.household);
  res.json({ members });
});

const removeMember = asyncHandler(async (req, res) => {
  const household = await householdService.removeMember(req.household, req.params.userId);
  res.json({ household });
});

module.exports = { create, join, getOne, getMine, getMembers, removeMember };

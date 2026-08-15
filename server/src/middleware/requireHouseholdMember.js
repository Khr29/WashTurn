const Household = require('../models/Household');
const { ApiError } = require('../utils/ApiError');
const { asyncHandler } = require('../utils/asyncHandler');

/**
 * Factory for membership-checking middleware.
 *
 * `resolveHouseholdId` may be:
 *   - a string: the req.params key holding the household id (default 'householdId')
 *   - a function(req): string | Promise<string> — used when the household id
 *     isn't directly in the URL (e.g. turn routes, which resolve it from the Turn doc)
 *
 * On success, attaches req.household (Mongoose doc) for downstream handlers.
 */
function requireHouseholdMember(resolveHouseholdId = 'householdId') {
  return asyncHandler(async (req, res, next) => {
    const householdId =
      typeof resolveHouseholdId === 'function'
        ? await resolveHouseholdId(req)
        : req.params[resolveHouseholdId];

    if (!householdId) {
      throw new ApiError(400, 'Household could not be determined for this request.');
    }

    const household = await Household.findById(householdId);
    if (!household) {
      throw new ApiError(404, 'Household not found.');
    }
    if (!household.isMember(req.user.id)) {
      throw new ApiError(403, 'You are not a member of this household.');
    }

    req.household = household;
    next();
  });
}

module.exports = { requireHouseholdMember };

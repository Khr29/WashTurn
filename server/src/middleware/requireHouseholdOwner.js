const { ApiError } = require('../utils/ApiError');

// Must run after requireHouseholdMember, which attaches req.household.
function requireHouseholdOwner(req, res, next) {
  if (req.household.ownerId.toString() !== req.user.id) {
    return next(new ApiError(403, 'Only the household owner can perform this action.'));
  }
  next();
}

module.exports = { requireHouseholdOwner };

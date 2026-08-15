const express = require('express');
const turnController = require('../controllers/turn.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireHouseholdMember } = require('../middleware/requireHouseholdMember');
const turnService = require('../services/turn.service');
const { ApiError } = require('../utils/ApiError');

const router = express.Router();

router.use(authenticate);

// Turn routes don't carry a householdId in the URL, so resolve it from the Turn
// document itself before checking membership.
const resolveHouseholdIdFromTurn = async (req) => {
  const turn = await turnService.findTurnOrThrow(req.params.id);
  if (!turn) throw new ApiError(404, 'Turn not found.');
  return turn.householdId;
};

router.post('/:id/start', requireHouseholdMember(resolveHouseholdIdFromTurn), turnController.start);
router.post('/:id/release', requireHouseholdMember(resolveHouseholdIdFromTurn), turnController.release);
router.post('/:id/claim', requireHouseholdMember(resolveHouseholdIdFromTurn), turnController.claim);
router.post('/:id/finish', requireHouseholdMember(resolveHouseholdIdFromTurn), turnController.finish);

module.exports = router;

const express = require('express');
const turnController = require('../controllers/turn.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireHouseholdMember } = require('../middleware/requireHouseholdMember');
const turnService = require('../services/turn.service');
const { ApiError } = require('../utils/ApiError');
const { requestCreationLimiter } = require('../middleware/rateLimit');

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

router.post('/:id/transfer', requireHouseholdMember(resolveHouseholdIdFromTurn), turnController.transfer);
router.get('/:id/requests', requireHouseholdMember(resolveHouseholdIdFromTurn), turnController.listRequests);
router.post(
  '/:id/requests',
  requestCreationLimiter,
  requireHouseholdMember(resolveHouseholdIdFromTurn),
  turnController.createRequest
);
router.post(
  '/:id/requests/:requestId/accept',
  requireHouseholdMember(resolveHouseholdIdFromTurn),
  turnController.acceptRequest
);
router.post(
  '/:id/requests/:requestId/reject',
  requireHouseholdMember(resolveHouseholdIdFromTurn),
  turnController.rejectRequest
);
router.post(
  '/:id/requests/:requestId/cancel',
  requireHouseholdMember(resolveHouseholdIdFromTurn),
  turnController.cancelRequest
);

module.exports = router;

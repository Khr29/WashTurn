const express = require('express');
const dryingController = require('../controllers/drying.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireHouseholdMember } = require('../middleware/requireHouseholdMember');
const dryingService = require('../services/drying.service');
const { ApiError } = require('../utils/ApiError');
const { requestCreationLimiter } = require('../middleware/rateLimit');

const router = express.Router();

router.use(authenticate);

// Drying requests aren't nested under a single URL-addressable parent
// resource the way turn requests are under a turn, so householdId travels in
// the body (create) / query string (list, balances) instead — resolved the
// same way turn.routes.js resolves it from the Turn document for action routes.
const resolveFromBody = (req) => req.body.householdId;
const resolveFromQuery = (req) => req.query.householdId;
const resolveFromDryingRequest = async (req) => {
  if (!req.params.id) throw new ApiError(400, 'Drying request id is required.');
  const dryingRequest = await dryingService.findDryingRequestOrThrow(req.params.id);
  return dryingRequest.householdId;
};

router.get('/balances', requireHouseholdMember(resolveFromQuery), dryingController.balances);
router.get('/', requireHouseholdMember(resolveFromQuery), dryingController.list);
router.post('/', requestCreationLimiter, requireHouseholdMember(resolveFromBody), dryingController.create);

router.post('/:id/accept', requireHouseholdMember(resolveFromDryingRequest), dryingController.accept);
router.post('/:id/reject', requireHouseholdMember(resolveFromDryingRequest), dryingController.reject);
router.post('/:id/cancel', requireHouseholdMember(resolveFromDryingRequest), dryingController.cancel);
router.post('/:id/complete', requireHouseholdMember(resolveFromDryingRequest), dryingController.complete);

module.exports = router;

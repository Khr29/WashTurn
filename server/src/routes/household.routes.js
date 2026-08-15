const express = require('express');
const householdController = require('../controllers/household.controller');
const scheduleController = require('../controllers/schedule.controller');
const machineController = require('../controllers/machine.controller');
const activityController = require('../controllers/activity.controller');
const { authenticate } = require('../middleware/authenticate');
const { requireHouseholdMember } = require('../middleware/requireHouseholdMember');
const { requireHouseholdOwner } = require('../middleware/requireHouseholdOwner');

const router = express.Router();

router.use(authenticate);

router.post('/', householdController.create);
router.post('/join', householdController.join);

router.get('/:id', requireHouseholdMember('id'), householdController.getOne);
router.get('/:id/members', requireHouseholdMember('id'), householdController.getMembers);
router.patch(
  '/:id/members/:userId',
  requireHouseholdMember('id'),
  requireHouseholdOwner,
  householdController.removeMember
);

router.get('/:id/schedule', requireHouseholdMember('id'), scheduleController.getSchedule);
router.put(
  '/:id/schedule',
  requireHouseholdMember('id'),
  requireHouseholdOwner,
  scheduleController.updateSchedule
);

router.get('/:id/machine', requireHouseholdMember('id'), machineController.getMachine);
router.get('/:id/turns/today', requireHouseholdMember('id'), machineController.getTodayTurn);

router.get('/:id/activity', requireHouseholdMember('id'), activityController.getActivity);

module.exports = router;

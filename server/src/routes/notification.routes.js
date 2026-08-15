const express = require('express');
const notificationController = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

router.post('/register-token', notificationController.registerToken);
router.delete('/register-token', notificationController.unregisterToken);

module.exports = router;

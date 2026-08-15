const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/logout', authenticate, authController.logout);
router.get('/me', authenticate, authController.me);

module.exports = router;

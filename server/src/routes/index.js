// MoneyDeck — API router
'use strict';
const express = require('express');
const { csrfGuard } = require('../middleware/auth');
const router = express.Router();

// CSRF protection on every mutating API call (single global enforcement point;
// unauthenticated requests such as /auth/login pass through untouched).
router.use(csrfGuard);

router.use('/auth', require('./auth'));
router.use('/documents', require('./documents'));
router.use('/notifications', require('./notifications'));
router.use('/college', require('./college'));
router.use('/officer', require('./officer'));

module.exports = router;

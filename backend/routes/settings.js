const express = require('express');
const logger = require('../services/logger');
const Settings = require('../models/Settings');
const authMiddleware = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/rateLimiter');
const router = express.Router();

// Rate limiting for settings routes
router.use(adminRateLimiter);

// Get all settings (admin only)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const settings = await Settings.find();
    const settingsObj = {};
    settings.forEach(s => {
      settingsObj[s.key] = s.value;
    });
    res.json(settingsObj);
  } catch (error) {
    return logRouteError(res, 'Error fetching settings', error);
  }
});

// Get a specific setting (admin only, except holiday/status)
router.get('/:key', authMiddleware, async (req, res) => {
  try {
    const value = await Settings.getValue(req.params.key);
    res.json({ key: req.params.key, value });
  } catch (error) {
    return logRouteError(res, 'Error fetching setting', error);
  }
});

// Update a setting (admin only)
router.put('/:key', authMiddleware, async (req, res) => {
  try {
    const { value } = req.body;
    const setting = await Settings.setValue(req.params.key, value, req.user?.username);
    logger.info('[Settings] Updated to by', { key: req.params.key, detail: JSON.stringify(value), username: req.user?.username });
    res.json(setting);
  } catch (error) {
    return logRouteError(res, 'Error updating setting', error);
  }
});

// Toggle holiday mode (admin only)
router.post('/holiday/toggle', authMiddleware, async (req, res) => {
  try {
    const currentValue = await Settings.getValue('holidayMode', false);
    const newValue = !currentValue;
    const setting = await Settings.setValue('holidayMode', newValue, req.user?.username);
    logger.info('[Settings] Holiday mode by', { detail: newValue ? 'ENABLED' : 'DISABLED', username: req.user?.username });
    res.json({ holidayMode: newValue });
  } catch (error) {
    return logRouteError(res, 'Error toggling holiday mode', error);
  }
});

// Get holiday mode status (public - for chatbot)
router.get('/holiday/status', async (req, res) => {
  try {
    const holidayMode = await Settings.getValue('holidayMode', false);
    res.json({ holidayMode });
  } catch (error) {
    return logRouteError(res, 'Error fetching holiday status', error);
  }
});

module.exports = router;

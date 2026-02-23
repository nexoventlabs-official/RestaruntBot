const express = require('express');
const groqAi = require('../services/groqAi');
const authMiddleware = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/rateLimiter');
const { logRouteError } = require('../services/logger');
const router = express.Router();

// Apply admin rate limiting
router.use(adminRateLimiter);

router.post('/generate-description', authMiddleware, async (req, res) => {
  try {
    const { name, category } = req.body;
    const description = await groqAi.generateDescription(name, category);
    res.json({ description });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.post('/generate-tags', authMiddleware, async (req, res) => {
  try {
    const { name, category, foodType, quantity, unit } = req.body;
    const tagsResult = await groqAi.generateTags(name, category, foodType, quantity, unit);
    const tags = Array.isArray(tagsResult) ? tagsResult : tagsResult.split(',').map(t => t.trim()).filter(Boolean);
    res.json({ tags });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

module.exports = router;

const express = require('express');
const SubCategory = require('../models/SubCategory');
const authMiddleware = require('../middleware/auth');
const dataEvents = require('../services/eventEmitter');
const { publicRateLimiter } = require('../middleware/rateLimiter');
const { logRouteError } = require('../services/logger');
const router = express.Router();

router.use(publicRateLimiter);

// List sub-categories (public — needed by the product form + storefront)
router.get('/', async (req, res) => {
  try {
    const subs = await SubCategory.find().sort({ name: 1 });
    res.json(subs);
  } catch (error) {
    return logRouteError(res, 'Internal server error', error);
  }
});

// Create
router.post('/', authMiddleware, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Sub-category name is required' });
    const existing = await SubCategory.findOne({ name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } });
    if (existing) return res.status(400).json({ error: 'Sub-category already exists' });
    const sub = new SubCategory({ name });
    await sub.save();
    dataEvents.emit('menu');
    res.status(201).json(sub);
  } catch (error) {
    return logRouteError(res, 'Internal server error', error);
  }
});

// Update (rename)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Sub-category name is required' });
    const sub = await SubCategory.findByIdAndUpdate(req.params.id, { name }, { new: true });
    if (!sub) return res.status(404).json({ error: 'Sub-category not found' });
    dataEvents.emit('menu');
    res.json(sub);
  } catch (error) {
    return logRouteError(res, 'Internal server error', error);
  }
});

// Delete
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const sub = await SubCategory.findByIdAndDelete(req.params.id);
    if (!sub) return res.status(404).json({ error: 'Sub-category not found' });
    dataEvents.emit('menu');
    res.json({ success: true });
  } catch (error) {
    return logRouteError(res, 'Internal server error', error);
  }
});

module.exports = router;

const express = require('express');
const MenuItem = require('../models/MenuItem');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const items = await MenuItem.find().sort({ category: 1, name: 1 });
    res.json(items);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/categories', async (req, res) => {
  try {
    const categories = await MenuItem.distinct('category');
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, price, category, unit, quantity, foodType, available, preparationTime, tags, image } = req.body;
    const item = new MenuItem({
      name, description, price: parseFloat(price), category,
      unit: unit || 'piece',
      quantity: parseFloat(quantity) || 1,
      foodType: foodType || 'none',
      available: available !== false && available !== 'false',
      preparationTime: parseInt(preparationTime) || 15,
      tags: typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      image: image || null
    });
    await item.save();
    res.status(201).json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, price, category, unit, quantity, foodType, available, preparationTime, tags, image } = req.body;
    const update = {
      name, description, price: parseFloat(price), category,
      unit: unit || 'piece',
      quantity: parseFloat(quantity) || 1,
      foodType: foodType || 'none',
      available: available !== false && available !== 'false',
      preparationTime: parseInt(preparationTime) || 15,
      tags: typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      image: image || null
    };
    
    const item = await MenuItem.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json(item);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await MenuItem.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

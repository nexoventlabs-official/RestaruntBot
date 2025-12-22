const express = require('express');
const Category = require('../models/Category');
const MenuItem = require('../models/MenuItem');
const authMiddleware = require('../middleware/auth');
const router = express.Router();

// Get all categories
router.get('/', async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true }).sort({ sortOrder: 1, name: 1 });
    res.json(categories);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create category
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { name, description, image } = req.body;
    const existing = await Category.findOne({ name: { $regex: new RegExp(`^${name}`, 'i') } });
    if (existing) {
      return res.status(400).json({ error: 'Category already exists' });
    }
    const category = new Category({ name, description, image });
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update category
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const { name, description, image, isActive, isPaused, sortOrder } = req.body;
    const category = await Category.findByIdAndUpdate(
      req.params.id,
      { name, description, image, isActive, isPaused, sortOrder },
      { new: true }
    );
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Toggle pause status
router.patch('/:id/toggle-pause', authMiddleware, async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    category.isPaused = !category.isPaused;
    await category.save();
    res.json(category);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete category
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    // Get the category name before deleting
    const category = await Category.findById(req.params.id);
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }

    const categoryName = category.name;

    // Find all menu items that have this category
    const itemsWithCategory = await MenuItem.find({ category: categoryName });

    let deletedItemsCount = 0;
    let updatedItemsCount = 0;

    for (const item of itemsWithCategory) {
      if (item.category.length === 1) {
        // Item only has this category, delete it
        await MenuItem.findByIdAndDelete(item._id);
        deletedItemsCount++;
      } else {
        // Item has multiple categories, remove this category from the array
        await MenuItem.findByIdAndUpdate(item._id, {
          $pull: { category: categoryName },
        });
        updatedItemsCount++;
      }
    }

    // Delete the category
    await Category.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: `Category deleted. ${deletedItemsCount} items deleted, ${updatedItemsCount} items updated.`,
      deletedItems: deletedItemsCount,
      updatedItems: updatedItemsCount,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

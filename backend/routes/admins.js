/**
 * Admin User Management Routes
 * 
 * Only accessible by superadmin role.
 * Allows creating, listing, and deleting admin users.
 */

const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const auth = require('../middleware/auth');
const { adminRateLimiter } = require('../middleware/rateLimiter');
const logger = require('../services/logger');
const { logRouteError } = require('../services/logger');

const router = express.Router();

// Apply auth + rate limiting to all routes
router.use(auth);
router.use(adminRateLimiter);

/**
 * Middleware: require superadmin role
 */
function requireSuperAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'superadmin') {
    return res.status(403).json({
      error: 'Only super admin can manage admin accounts',
      code: 'FORBIDDEN'
    });
  }
  next();
}

// Validation helper
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: errors.array()[0].msg,
      errors: errors.array().map(e => ({ field: e.path, message: e.msg }))
    });
  }
  next();
};

/**
 * GET /api/admins
 * List all admin users (excluding superadmins and the password field)
 */
router.get('/', requireSuperAdmin, async (req, res) => {
  try {
    const admins = await User.find({ role: 'admin' })
      .select('-password -pushToken')
      .sort('-createdAt');
    res.json(admins);
  } catch (error) {
    return logRouteError(res, 'Failed to list admins', error);
  }
});

/**
 * POST /api/admins
 * Create a new admin user
 */
router.post(
  '/',
  requireSuperAdmin,
  body('username')
    .trim()
    .notEmpty().withMessage('Username is required')
    .isLength({ min: 3, max: 50 }).withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_.-]+$/).withMessage('Username can only contain letters, numbers, _ . -'),
  body('password')
    .trim()
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
  handleValidation,
  async (req, res) => {
    try {
      const { username, password } = req.body;

      // Check if username already exists
      const existing = await User.findOne({ username });
      if (existing) {
        return res.status(409).json({ error: 'Username already exists' });
      }

      // Do not allow creating another superadmin via this endpoint
      const admin = new User({
        username,
        password, // hashed in User model pre-save hook
        role: 'admin'
      });
      await admin.save();

      logger.info('New admin created by superadmin', {
        createdBy: req.user.id,
        newAdminUsername: username
      });

      // Return without password
      const { password: _p, ...safe } = admin.toObject();
      res.status(201).json(safe);
    } catch (error) {
      return logRouteError(res, 'Failed to create admin', error);
    }
  }
);

/**
 * PATCH /api/admins/:id/password
 * Reset an admin's password
 */
router.patch(
  '/:id/password',
  requireSuperAdmin,
  body('password')
    .trim()
    .notEmpty().withMessage('Password is required')
    .isLength({ min: 6, max: 128 }).withMessage('Password must be at least 6 characters'),
  handleValidation,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      const admin = await User.findById(id);
      if (!admin) {
        return res.status(404).json({ error: 'Admin not found' });
      }
      if (admin.role !== 'admin') {
        return res.status(403).json({ error: 'Cannot modify non-admin accounts' });
      }

      admin.password = password; // hashed in pre-save hook
      await admin.save();

      logger.info('Admin password reset by superadmin', {
        changedBy: req.user.id,
        adminId: id
      });

      res.json({ message: 'Password updated successfully' });
    } catch (error) {
      return logRouteError(res, 'Failed to update admin password', error);
    }
  }
);

/**
 * DELETE /api/admins/:id
 * Delete an admin user
 */
router.delete('/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await User.findById(id);
    if (!admin) {
      return res.status(404).json({ error: 'Admin not found' });
    }
    if (admin.role !== 'admin') {
      return res.status(403).json({ error: 'Cannot delete non-admin accounts' });
    }

    await User.findByIdAndDelete(id);

    logger.info('Admin deleted by superadmin', {
      deletedBy: req.user.id,
      deletedAdminId: id,
      deletedAdminUsername: admin.username
    });

    res.json({ message: 'Admin deleted successfully', id });
  } catch (error) {
    return logRouteError(res, 'Failed to delete admin', error);
  }
});

module.exports = router;

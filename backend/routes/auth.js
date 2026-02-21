const express = require('express');
const logger = require('../services/logger');
const { logRouteError } = require('../services/logger');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { authRateLimiter, strictRateLimiter } = require('../middleware/rateLimiter');
const { generateTokenPair, rotateRefreshToken, revokeRefreshToken } = require('../services/jwtRefresh');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const DeliveryBoy = require('../models/DeliveryBoy');
const pushNotification = require('../services/pushNotification');
const router = express.Router();

// Validation helper
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array().map(e => ({ field: e.path, message: e.msg })) });
  }
  next();
};

// Test push notification - admin only (requires auth token)
router.post('/test-push', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { pushToken } = req.body;
    if (!pushToken) {
      return res.status(400).json({ error: 'pushToken is required in request body' });
    }
    
    const result = await pushNotification.sendTestNotification(pushToken);
    res.json({ message: 'Test notification sent', result });
  } catch (error) {
    logRouteError(res, 'Test push error', error);
  }
});

router.post('/login',
  strictRateLimiter,
  body('username').trim().notEmpty().withMessage('Username is required').isLength({ max: 100 }),
  body('password').trim().notEmpty().withMessage('Password is required').isLength({ max: 128 }),
  handleValidation,
  async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check env credentials first
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      // Find or create admin user in database for push token storage
      let adminUser = await User.findOne({ username });
      if (!adminUser) {
        // Create admin user in database (password won't be used since we check env first)
        adminUser = new User({ 
          username, 
          password: crypto.randomBytes(32).toString('hex'),
          role: 'admin' 
        });
        await adminUser.save();
        logger.info('📱 Created admin user in database for push notifications');
      }
      
      // Issue short-lived access token + refresh token pair
      const tokens = generateTokenPair(adminUser._id.toString(), 'admin');
      // Also issue a legacy-compatible 'token' field (short-lived access token)
      return res.json({
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.accessTokenExpiresIn,
        user: { username, role: 'admin' }
      });
    }

    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const tokens = generateTokenPair(user._id.toString(), user.role);
    res.json({
      token: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.accessTokenExpiresIn,
      user: { username: user.username, role: user.role }
    });
  } catch (error) {

    return logRouteError(res, 'Internal server error', error);
  }
});

router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (error) {
    logger.warn('Token verification failed', { error: error.message });
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Refresh access token using refresh token
router.post('/refresh',
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
  handleValidation,
  (req, res) => {
    try {
      const { refreshToken } = req.body;
      const tokens = rotateRefreshToken(refreshToken);
      res.json({
        token: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.accessTokenExpiresIn
      });
    } catch (error) {
      logger.warn('Refresh token rejected', { error: error.message });
      res.status(401).json({ error: error.message });
    }
  }
);

// Revoke refresh token on logout
router.post('/revoke',
  body('refreshToken').notEmpty().withMessage('Refresh token is required'),
  handleValidation,
  (req, res) => {
    try {
      const { refreshToken } = req.body;
      revokeRefreshToken(refreshToken);
      res.json({ message: 'Token revoked' });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
);

// Update push notification token for admin
router.post('/push-token', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { pushToken } = req.body;
    
    if (!pushToken) {
      return res.status(400).json({ error: 'Push token is required' });
    }
    
    // If user has an ID (database user), update their push token
    if (decoded.id) {
      await User.findByIdAndUpdate(decoded.id, { pushToken });
      logger.info('Admin push token saved for : ...', { username: decoded.username, detail: pushToken.substring(0, 30) });
    } else {
      // Try to find user by username and update (for legacy tokens without ID)
      const user = await User.findOneAndUpdate(
        { username: decoded.username },
        { pushToken },
        { new: true }
      );
      if (user) {
        logger.info('Admin push token saved (by username) for : ...', { username: decoded.username, detail: pushToken.substring(0, 30) });
      } else {
        logger.warn('No database user found for - push token not saved!', { username : decoded.username });
      }
    }
    
    res.json({ message: 'Push token updated' });
  } catch (error) {
    logger.error('Push token error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Clear push notification token on logout
router.delete('/push-token', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.id) {
      await User.findByIdAndUpdate(decoded.id, { pushToken: null });
      logger.info('Admin push token cleared for', { username : decoded.username });
    } else {
      await User.findOneAndUpdate(
        { username: decoded.username },
        { pushToken: null }
      );
      logger.info('Admin push token cleared (by username) for', { username : decoded.username });
    }
    
    res.json({ message: 'Push token cleared' });
  } catch (error) {
    logger.error('Clear push token error:', error);
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Clear push token by value — fallback for logout when JWT is expired.
// This does NOT require authentication. It simply removes the given
// push token from any User or DeliveryBoy document that has it.
// Safe because push tokens are opaque device identifiers with no
// security value — clearing them only stops notifications.

router.post('/clear-push-token', strictRateLimiter, async (req, res) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken || typeof pushToken !== 'string' || pushToken.length < 20) {
      return res.status(400).json({ error: 'Valid pushToken is required' });
    }

    // Clear from both collections — one will match, the other is a no-op
    const [adminResult, deliveryResult] = await Promise.all([
      User.updateMany({ pushToken }, { pushToken: null }),
      DeliveryBoy.updateMany({ pushToken }, { pushToken: null }),
    ]);

    const cleared = (adminResult.modifiedCount || 0) + (deliveryResult.modifiedCount || 0);
    logger.info('Push token cleared via fallback endpoint ( doc(s) updated)', { cleared });

    res.json({ message: 'Push token cleared', cleared });
  } catch (error) {
    logRouteError(res, 'Clear push token error', error);
  }
});

// Reset badge count for admin
router.post('/reset-badge', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user's push token and reset badge
    if (decoded.id) {
      const user = await User.findById(decoded.id);
      if (user && user.pushToken) {
        pushNotification.resetBadgeCount(user.pushToken);
      }
    }
    
    res.json({ message: 'Badge count reset' });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Test push notification endpoint (for debugging)
router.post('/test-notification', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user's push token
    if (decoded.id) {
      const user = await User.findById(decoded.id);
      if (user && user.pushToken) {
        const result = await pushNotification.sendTestNotification(user.pushToken);
        res.json({ message: 'Test notification sent', result, pushToken: user.pushToken });
      } else {
        res.status(400).json({ error: 'No push token registered for this user' });
      }
    } else {
      res.status(400).json({ error: 'User ID not found' });
    }
  } catch (error) {
    logRouteError(res, 'Test notification error', error);
  }
});

module.exports = router;

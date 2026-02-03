const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

// Public test endpoint - send test notification to any push token (for debugging)
router.post('/test-push', async (req, res) => {
  try {
    const { pushToken } = req.body;
    
    if (!pushToken) {
      return res.status(400).json({ error: 'pushToken is required in request body' });
    }
    
    const pushNotification = require('../services/pushNotification');
    console.log('📱 Testing push notification to:', pushToken);
    
    const result = await pushNotification.sendTestNotification(pushToken);
    res.json({ message: 'Test notification sent', result });
  } catch (error) {
    console.error('Test push error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    // Check env credentials first
    if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
      const token = jwt.sign({ username, role: 'admin' }, process.env.JWT_SECRET, { expiresIn: '24h' });
      return res.json({ token, user: { username, role: 'admin' } });
    }

    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign({ id: user._id, username: user.username, role: user.role }, process.env.JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { username: user.username, role: user.role } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/verify', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
});

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
    }
    
    console.log(`📱 Admin push token updated for ${decoded.username}`);
    
    res.json({ message: 'Push token updated' });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
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
        const pushNotification = require('../services/pushNotification');
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
        const pushNotification = require('../services/pushNotification');
        const result = await pushNotification.sendTestNotification(user.pushToken);
        res.json({ message: 'Test notification sent', result, pushToken: user.pushToken });
      } else {
        res.status(400).json({ error: 'No push token registered for this user' });
      }
    } else {
      res.status(400).json({ error: 'User ID not found' });
    }
  } catch (error) {
    console.error('Test notification error:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

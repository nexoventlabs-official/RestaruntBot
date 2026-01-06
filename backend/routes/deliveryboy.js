const express = require('express');
const jwt = require('jsonwebtoken');
const DeliveryBoy = require('../models/DeliveryBoy');
const auth = require('../middleware/auth');
const brevoMail = require('../services/brevoMail');
const cloudinaryService = require('../services/cloudinary');
const multer = require('multer');
const router = express.Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Generate random password
const generatePassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let password = '';
  for (let i = 0; i < 8; i++) {
    password += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return password;
};

// Send password email to delivery boy
const sendPasswordEmail = async (email, name, password) => {
  const SibApiV3Sdk = require('sib-api-v3-sdk');
  const defaultClient = SibApiV3Sdk.ApiClient.instance;
  const apiKey = defaultClient.authentications['api-key'];
  apiKey.apiKey = process.env.BREVO_API_KEY;
  
  const apiInstance = new SibApiV3Sdk.TransactionalEmailsApi();
  const sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail();
  
  sendSmtpEmail.subject = 'Welcome to FoodAdmin - Your Login Credentials';
  sendSmtpEmail.htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #e63946, #ff6b6b); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0;">🚴 Welcome to FoodAdmin!</h1>
      </div>
      <div style="padding: 30px; background: #f8f9fb;">
        <h2 style="color: #1c1d21;">Hello ${name}!</h2>
        <p style="color: #61636b; font-size: 16px;">You have been added as a Delivery Partner. Here are your login credentials:</p>
        
        <div style="background: white; padding: 20px; border-radius: 10px; margin: 20px 0; border-left: 4px solid #e63946;">
          <p style="margin: 10px 0;"><strong>Email:</strong> ${email}</p>
          <p style="margin: 10px 0;"><strong>Password:</strong> <code style="background: #f0f0f0; padding: 5px 10px; border-radius: 5px; font-size: 18px;">${password}</code></p>
        </div>
        
        <p style="color: #e63946; font-weight: bold;">⚠️ Please change your password after first login!</p>
        
        <p style="color: #61636b;">Login at: <a href="https://restaruntbot.vercel.app/delivery/login" style="color: #e63946;">Delivery Portal</a></p>
      </div>
      <div style="padding: 20px; text-align: center; color: #61636b; font-size: 12px;">
        <p>This is an automated message from FoodAdmin.</p>
      </div>
    </div>
  `;
  sendSmtpEmail.sender = { name: process.env.BREVO_FROM_NAME || 'FoodAdmin', email: process.env.BREVO_FROM_EMAIL };
  sendSmtpEmail.to = [{ email, name }];

  try {
    await apiInstance.sendTransacEmail(sendSmtpEmail);
    console.log(`📧 Password email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('Brevo email error:', error.message);
    return false;
  }
};

// ============ ADMIN ROUTES (Protected) ============

// Get all delivery boys (Admin)
router.get('/', auth, async (req, res) => {
  try {
    const deliveryBoys = await DeliveryBoy.find().select('-password').sort({ createdAt: -1 });
    res.json(deliveryBoys);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add new delivery boy (Admin)
router.post('/', auth, upload.single('photo'), async (req, res) => {
  try {
    const { name, email, phone, dob } = req.body;
    
    // Check if email already exists
    const existing = await DeliveryBoy.findOne({ email });
    if (existing) {
      return res.status(400).json({ error: 'Email already registered' });
    }
    
    // Generate password
    const password = generatePassword();
    
    // Upload photo if provided
    let photoUrl = '';
    let photoPublicId = null;
    
    if (req.file) {
      const cloudinary = require('cloudinary').v2;
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'restaurant-bot/delivery-boys',
            public_id: `delivery_${Date.now()}`,
            transformation: [
              { width: 300, height: 300, crop: 'fill', gravity: 'face' },
              { quality: 'auto:best', fetch_format: 'auto' }
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });
      photoUrl = uploadResult.secure_url;
      photoPublicId = uploadResult.public_id;
    }
    
    // Create delivery boy
    const deliveryBoy = new DeliveryBoy({
      name,
      email,
      phone,
      password,
      dob: new Date(dob),
      photo: photoUrl,
      photoPublicId
    });
    
    await deliveryBoy.save();
    
    // Send password email
    await sendPasswordEmail(email, name, password);
    
    // Return without password
    const result = deliveryBoy.toObject();
    delete result.password;
    
    res.status(201).json(result);
  } catch (error) {
    console.error('Add delivery boy error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update delivery boy (Admin)
router.put('/:id', auth, upload.single('photo'), async (req, res) => {
  try {
    const { name, phone, dob, isActive } = req.body;
    const deliveryBoy = await DeliveryBoy.findById(req.params.id);
    
    if (!deliveryBoy) {
      return res.status(404).json({ error: 'Delivery boy not found' });
    }
    
    // Update fields
    if (name) deliveryBoy.name = name;
    if (phone) deliveryBoy.phone = phone;
    if (dob) deliveryBoy.dob = new Date(dob);
    if (typeof isActive === 'boolean' || isActive === 'true' || isActive === 'false') {
      deliveryBoy.isActive = isActive === true || isActive === 'true';
    }
    
    // Upload new photo if provided
    if (req.file) {
      // Delete old photo
      if (deliveryBoy.photoPublicId) {
        try {
          await cloudinaryService.deleteImage(deliveryBoy.photoPublicId);
        } catch (e) {
          console.log('Could not delete old photo:', e.message);
        }
      }
      
      const cloudinary = require('cloudinary').v2;
      const uploadResult = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'restaurant-bot/delivery-boys',
            public_id: `delivery_${Date.now()}`,
            transformation: [
              { width: 300, height: 300, crop: 'fill', gravity: 'face' },
              { quality: 'auto:best', fetch_format: 'auto' }
            ]
          },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        uploadStream.end(req.file.buffer);
      });
      deliveryBoy.photo = uploadResult.secure_url;
      deliveryBoy.photoPublicId = uploadResult.public_id;
    }
    
    await deliveryBoy.save();
    
    const result = deliveryBoy.toObject();
    delete result.password;
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete delivery boy (Admin) - This will invalidate their token
router.delete('/:id', auth, async (req, res) => {
  try {
    const deliveryBoy = await DeliveryBoy.findById(req.params.id);
    
    if (!deliveryBoy) {
      return res.status(404).json({ error: 'Delivery boy not found' });
    }
    
    // Delete photo from Cloudinary
    if (deliveryBoy.photoPublicId) {
      try {
        await cloudinaryService.deleteImage(deliveryBoy.photoPublicId);
      } catch (e) {
        console.log('Could not delete photo:', e.message);
      }
    }
    
    await DeliveryBoy.findByIdAndDelete(req.params.id);
    
    res.json({ message: 'Delivery boy deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reset password (Admin) - Send new password via email
router.post('/:id/reset-password', auth, async (req, res) => {
  try {
    const deliveryBoy = await DeliveryBoy.findById(req.params.id);
    
    if (!deliveryBoy) {
      return res.status(404).json({ error: 'Delivery boy not found' });
    }
    
    // Generate new password
    const newPassword = generatePassword();
    deliveryBoy.password = newPassword;
    deliveryBoy.tokenVersion += 1; // Invalidate existing tokens
    await deliveryBoy.save();
    
    // Send email
    await sendPasswordEmail(deliveryBoy.email, deliveryBoy.name, newPassword);
    
    res.json({ message: 'New password sent to email' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ DELIVERY BOY AUTH ROUTES (Public) ============

// Delivery boy login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const deliveryBoy = await DeliveryBoy.findOne({ email });
    
    if (!deliveryBoy) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    if (!deliveryBoy.isActive) {
      return res.status(401).json({ error: 'Account is deactivated. Contact admin.' });
    }
    
    const isMatch = await deliveryBoy.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Update last login
    deliveryBoy.lastLogin = new Date();
    deliveryBoy.isOnline = true;
    await deliveryBoy.save();
    
    // Generate token with tokenVersion
    const token = jwt.sign(
      { 
        id: deliveryBoy._id, 
        email: deliveryBoy.email, 
        role: 'delivery',
        tokenVersion: deliveryBoy.tokenVersion
      }, 
      process.env.JWT_SECRET, 
      { expiresIn: '7d' }
    );
    
    const user = deliveryBoy.toObject();
    delete user.password;
    
    res.json({ token, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Verify delivery boy token
router.get('/verify', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'delivery') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // Check if delivery boy still exists and token version matches
    const deliveryBoy = await DeliveryBoy.findById(decoded.id).select('-password');
    
    if (!deliveryBoy) {
      return res.status(401).json({ error: 'Account deleted' });
    }
    
    if (!deliveryBoy.isActive) {
      return res.status(401).json({ error: 'Account deactivated' });
    }
    
    if (deliveryBoy.tokenVersion !== decoded.tokenVersion) {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    
    res.json({ valid: true, user: deliveryBoy });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

// Change password (Delivery boy)
router.post('/change-password', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'delivery') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current and new password required' });
    }
    
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    
    const deliveryBoy = await DeliveryBoy.findById(decoded.id);
    
    if (!deliveryBoy) {
      return res.status(404).json({ error: 'Account not found' });
    }
    
    const isMatch = await deliveryBoy.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    
    deliveryBoy.password = newPassword;
    deliveryBoy.passwordChangedAt = new Date();
    await deliveryBoy.save();
    
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update online status (Delivery boy)
router.post('/status', async (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    if (decoded.role !== 'delivery') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    const { isOnline } = req.body;
    
    await DeliveryBoy.findByIdAndUpdate(decoded.id, { isOnline });
    
    res.json({ message: 'Status updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

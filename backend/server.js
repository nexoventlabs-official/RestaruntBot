require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/order');
const webhookRoutes = require('./routes/webhook');
const paymentRoutes = require('./routes/payment');
const customerRoutes = require('./routes/customer');
const analyticsRoutes = require('./routes/analytics');
const aiRoutes = require('./routes/ai');
const categoryRoutes = require('./routes/category');
const orderScheduler = require('./services/orderScheduler');
const dailyCleanup = require('./services/dailyCleanup');

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Log all API requests for debugging
app.use('/api', (req, res, next) => {
  console.log(`📥 ${req.method} ${req.originalUrl}`);
  next();
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('MongoDB connected');
    // Start schedulers after DB connection
    orderScheduler.start();
    dailyCleanup.start();
  })
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/categories', categoryRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Test endpoint for Google Sheets sync
app.get('/api/test-sheets/:orderId/:status', async (req, res) => {
  const googleSheets = require('./services/googleSheets');
  const { orderId, status } = req.params;
  console.log('🧪 Test sheets update:', orderId, status);
  try {
    const result = await googleSheets.updateOrderStatus(orderId, status, status === 'cancelled' ? 'cancelled' : null);
    res.json({ success: result, orderId, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Sync all cancelled orders to Google Sheets
app.get('/api/sync-cancelled', async (req, res) => {
  const Order = require('./models/Order');
  const googleSheets = require('./services/googleSheets');
  console.log('🔄 Syncing all cancelled orders to Google Sheets...');
  try {
    const cancelledOrders = await Order.find({ status: 'cancelled' });
    let synced = 0;
    for (const order of cancelledOrders) {
      const result = await googleSheets.updateOrderStatus(order.orderId, 'cancelled', order.paymentStatus);
      if (result) synced++;
    }
    res.json({ success: true, total: cancelledOrders.length, synced });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

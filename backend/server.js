require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet'); // Phase 5.1: Security headers
const path = require('path');
const dataEvents = require('./services/eventEmitter');
const { validateEnv, isProduction } = require('./config/envValidation');
const { corsOptions, validateCorsConfig } = require('./config/corsConfig');

// Validate environment variables before starting
validateEnv();

// Validate CORS configuration
const corsValidation = validateCorsConfig();
if (!corsValidation.valid) {
  console.warn('⚠️ CORS Configuration Warnings:');
  corsValidation.warnings.forEach(w => console.warn(`   - ${w}`));
}

const authRoutes = require('./routes/auth');
const menuRoutes = require('./routes/menu');
const orderRoutes = require('./routes/order');
const webhookRoutes = require('./routes/webhook');
const paymentRoutes = require('./routes/payment');
const customerRoutes = require('./routes/customer');
const analyticsRoutes = require('./routes/analytics');
const aiRoutes = require('./routes/ai');
const categoryRoutes = require('./routes/category');
const publicRoutes = require('./routes/public');
const chatbotImagesRoutes = require('./routes/chatbotImages');
const deliveryBoyRoutes = require('./routes/deliveryboy');
const heroSectionRoutes = require('./routes/heroSection');
const offersRoutes = require('./routes/offers');
const whatsappBroadcastRoutes = require('./routes/whatsappBroadcast');
const settingsRoutes = require('./routes/settings');
const metricsRoutes = require('./routes/metrics'); // Phase 4.2: Metrics endpoint
const healthRoutes = require('./routes/health'); // Phase 5.1: Health checks
const databaseRoutes = require('./routes/database'); // Phase 6.7: Database management
const cacheRoutes = require('./routes/cache'); // Phase 6.9: Cache management
const pushNotificationsRoutes = require('./routes/pushNotifications'); // Phase 6.10: Push notifications
const { swaggerUi, swaggerSpec } = require('./swagger'); // Phase 5.3: API documentation
const orderScheduler = require('./services/orderScheduler');
const dailyCleanup = require('./services/dailyCleanup');
const categoryScheduler = require('./services/categoryScheduler');
const orderCleanup = require('./services/orderCleanup');
const cartCleanup = require('./services/cartCleanup');
const messageRetryScheduler = require('./services/messageRetryScheduler');
const googleSheets = require('./services/googleSheets');
const databaseMonitoring = require('./services/databaseMonitoring'); // Phase 6.7
const dataRetention = require('./services/dataRetention'); // Phase 6.7
const cache = require('./services/cache'); // Phase 6.9
const cron = require('node-cron'); // Phase 6.7

const app = express();

// Capture raw body for webhook signature verification (BEFORE express.json())
app.use('/api/webhook/meta', (req, res, next) => {
  let rawBody = '';
  req.on('data', chunk => {
    rawBody += chunk.toString();
  });
  req.on('end', () => {
    req.rawBody = rawBody;
    next();
  });
});

// CORS configuration - environment-aware with explicit origins
// Handle preflight requests for all routes
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' })); // Phase 5.1: Request size limit for security
app.use(express.urlencoded({ extended: true, limit: '10mb' })); // Phase 5.1: URL-encoded body limit
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Security headers - Phase 5.1: Using helmet for comprehensive security
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for now (can be configured later)
  crossOriginEmbedderPolicy: false // Allow embedding for admin dashboard
}));

// Log all API requests for debugging
app.use('/api', (req, res, next) => {
  console.log(`📥 ${req.method} ${req.originalUrl}`);
  next();
});

// MongoDB Connection with optimized pooling
// Phase 5.3: Database connection pooling optimization
const mongooseOptions = {
  maxPoolSize: 10, // Maximum number of connections in the pool
  minPoolSize: 2, // Minimum number of connections
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  serverSelectionTimeoutMS: 5000, // Timeout for server selection
  family: 4 // Use IPv4, skip trying IPv6
};

mongoose.connect(process.env.MONGODB_URI, mongooseOptions)
  .then(async () => {
    console.log('✅ MongoDB connected');
    
    // Phase 6.4: Initialize Redis connection
    console.log('🔄 Initializing Redis...');
    const redis = require('./services/redis');
    const redisHealth = await redis.healthCheck();
    if (redisHealth.connected) {
      console.log('✅ Redis connected');
    } else {
      console.error('❌ Redis connection failed:', redisHealth.error);
      console.warn('⚠️ Server will continue without Redis (rate limiting and queue disabled)');
    }
    
    // Start schedulers after DB connection
    orderScheduler.start();
    dailyCleanup.start();
    categoryScheduler.start();
    orderCleanup.start();
    cartCleanup.startCartCleanupScheduler();
    messageRetryScheduler.start(); // ✅ NEW: Start message retry scheduler
    
    // Initialize Google Sheets (cost-saving sheets)
    console.log('📊 Initializing Google Sheets...');
    await googleSheets.initializeDailyReportsSheet();
    await googleSheets.initializeDashboardStatsSheet();
    await googleSheets.initializeCustomersSheet();
    console.log('✅ Google Sheets initialized');
    
    // Phase 6.7: Start database monitoring
    console.log('🔄 Starting database monitoring...');
    databaseMonitoring.startMonitoring();
    console.log('✅ Database monitoring started');
    
    // Phase 6.7: Schedule data retention policies (daily at 2 AM)
    cron.schedule('0 2 * * *', async () => {
      console.log('🔄 Running scheduled data retention policies...');
      await dataRetention.runRetentionPolicies();
    });
    console.log('✅ Data retention scheduler configured (daily at 2 AM)');
    
    // Phase 6.9: Warm cache on startup
    console.log('🔥 Warming cache...');
    await cache.warmCache();
    console.log('✅ Cache warmed');
    
    // Phase 6.4: Message queue is initialized automatically when imported
    console.log('✅ Message queue initialized');
  })
  .catch(err => console.error('MongoDB connection error:', err));

app.use('/api/auth', authRoutes);
app.use('/api/token', require('./routes/token')); // Phase 6.3: Token refresh routes
app.use('/api/menu', menuRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/webhook', webhookRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/chatbot-images', chatbotImagesRoutes);
app.use('/api/delivery', deliveryBoyRoutes);
app.use('/api/hero-sections', heroSectionRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/whatsapp-broadcast', whatsappBroadcastRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/metrics', metricsRoutes); // Phase 4.2: Metrics endpoint
app.use('/api/database', databaseRoutes); // Phase 6.7: Database management
app.use('/api/cache', cacheRoutes); // Phase 6.9: Cache management
app.use('/api/push-notifications', pushNotificationsRoutes); // Phase 6.10: Push notifications
app.use('/health', healthRoutes); // Phase 5.1: Health checks (no /api prefix for standard health endpoints)

// Swagger API Documentation - Phase 5.3
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Restaurant Bot API Docs'
}));

// Root route - API status
app.get('/', (req, res) => res.json({ 
  status: 'ok', 
  message: 'FoodAdmin API is running',
  version: '1.0.0'
}));

// SSE endpoint for real-time updates
const sseClients = new Set();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  sseClients.add(res);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

// Broadcast to all SSE clients
const broadcast = (type) => sseClients.forEach(c => c.write(`data: ${JSON.stringify({ type })}\n\n`));

dataEvents.on('orders', () => broadcast('orders'));
dataEvents.on('dashboard', () => broadcast('dashboard'));
dataEvents.on('customers', () => broadcast('customers'));
dataEvents.on('menu', () => broadcast('menu'));
dataEvents.on('deliveryboys', () => broadcast('deliveryboys'));
dataEvents.on('offers', () => broadcast('offers'));

// Also listen for dataUpdate events (alternative format used in some routes)
dataEvents.on('dataUpdate', (data) => {
  if (data && data.type) {
    broadcast(data.type);
  }
});

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

// Sync pending refund orders to refundprocessing sheet
app.get('/api/sync-pending-refunds', async (req, res) => {
  const googleSheets = require('./services/googleSheets');
  console.log('🔄 Syncing pending refund orders to Google Sheets...');
  try {
    const result = await googleSheets.syncPendingRefunds();
    res.json({ success: result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Global error handler (must be last middleware)
const errorHandler = require('./middleware/errorHandler');
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health checks available at:`);
  console.log(`  - GET /health (basic)`);
  console.log(`  - GET /health/ready (readiness)`);
  console.log(`  - GET /health/live (liveness)`);
  console.log(`  - GET /health/metrics (with metrics)`);
  console.log(`  - GET /health/detailed (detailed)`);
});

// Graceful shutdown handling
// Phase 5.1: Production Improvements
let isShuttingDown = false;

function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('⚠️ Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  console.log(`\n🛑 ${signal} received. Starting graceful shutdown...`);
  
  // Stop accepting new connections
  server.close(() => {
    console.log('✅ HTTP server closed');
    
    // Phase 6.4: Shutdown Redis and message queue
    Promise.all([
      require('./services/redis').shutdown(),
      require('./services/messageQueue').shutdown()
    ]).then(() => {
      console.log('✅ Redis and message queue closed');
      
      // Phase 6.7: Stop database monitoring
      require('./services/databaseMonitoring').stopMonitoring();
      console.log('✅ Database monitoring stopped');
      
      // Close database connection
      mongoose.connection.close(false, () => {
        console.log('✅ MongoDB connection closed');
        
        // Stop schedulers
        console.log('✅ Schedulers stopped');
        
        console.log('✅ Graceful shutdown complete');
        process.exit(0);
      });
    }).catch(err => {
      console.error('❌ Error during shutdown:', err);
      process.exit(1);
    });
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    console.error('⚠️ Forced shutdown after 30s timeout');
    process.exit(1);
  }, 30000);
}

// Listen for termination signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('UNHANDLED_REJECTION');
});


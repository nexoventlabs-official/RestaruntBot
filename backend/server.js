require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const dataEvents = require('./services/eventEmitter');
const { validateEnv } = require('./config/envValidation');
const { corsOptions } = require('./config/corsConfig');
const errorHandler = require('./middleware/errorHandler');
const { sanitizeInputs } = require('./middleware/inputValidation');
const { correlationMiddleware } = require('./services/correlationContext');
const logger = require('./services/logger');
const { swaggerUi, swaggerSpec } = require('./swagger');

const authRoutes = require('./routes/auth');
const adminsRoutes = require('./routes/admins');
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
const flowImagesRoutes = require('./routes/flowImages');
const deliveryBoyRoutes = require('./routes/deliveryboy');
const heroSectionRoutes = require('./routes/heroSection');
const offersRoutes = require('./routes/offers');
const whatsappBroadcastRoutes = require('./routes/whatsappBroadcast');
const settingsRoutes = require('./routes/settings');
const healthRoutes = require('./routes/health');
const catalogRoutes = require('./routes/catalog');
const flowEndpointRoutes = require('./routes/flowEndpoint');
const orderScheduler = require('./services/orderScheduler');
const dailyCleanup = require('./services/dailyCleanup');
const categoryScheduler = require('./services/categoryScheduler');
const menuItemScheduler = require('./services/menuItemScheduler');
const orderCleanup = require('./services/orderCleanup');
const cartCleanup = require('./services/cartCleanup');
const catalogReviewPoller = require('./services/catalogReviewPoller');
const catalogRatingSync = require('./services/catalogRatingSync');
const orderReconciliation = require('./services/orderReconciliation');
const outboundRetryWorker = require('./services/outboundRetryWorker');
const dashboardStatsSync = require('./services/dashboardStatsSync');
const pushTokenCleanup = require('./services/pushTokenCleanup');
const offerScheduler = require('./services/offerScheduler');
const googleSheets = require('./services/googleSheets');

// Validate environment variables at startup (always strict for critical vars)
validateEnv(true);

const app = express();

// Trust proxy (required behind nginx/load balancer for correct req.ip)
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disable CSP for API server (frontend handles its own)
  crossOriginEmbedderPolicy: false
}));

// Response compression
app.use(compression());

// CORS configuration (using environment-aware config)
app.options('*', cors(corsOptions));
app.use(cors(corsOptions));

// Body parsing with size limits
// The verify callback captures the raw body buffer for webhook signature verification
app.use(express.json({
  limit: '2mb',
  verify: (req, _res, buf) => {
    // Only store rawBody for webhook routes that need signature verification
    if (req.originalUrl && req.originalUrl.startsWith('/api/webhook/meta')) {
      req.rawBody = buf.toString();
    }
  }
}));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// Global input sanitization
app.use(sanitizeInputs);

// Correlation ID middleware for request tracing
app.use(correlationMiddleware);

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Request + response logging with duration tracking
app.use('/api', (req, res, next) => {
  const start = Date.now();
  const { method, originalUrl, ip } = req;

  // Log on response finish
  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger[level]('HTTP request completed', {
      method,
      path: originalUrl,
      statusCode: res.statusCode,
      durationMs,
      contentLength: res.get('content-length') || 0,
      ip,
      type: 'http'
    });
  });
  next();
});

// Swagger API documentation (disabled in production if preferred)
if (process.env.NODE_ENV !== 'production') {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    explorer: true,
    customSiteTitle: 'FoodAdmin API Docs'
  }));
}
// Swagger JSON spec only available in development
if (process.env.NODE_ENV !== 'production') {
  app.get('/api-docs.json', (req, res) => res.json(swaggerSpec));
}

// MongoDB connection with reconnection handling
let mongoRetryCount = 0;
const MONGO_MAX_RETRIES = 20;
const MONGO_BASE_DELAY = 5000;
const connectMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      heartbeatFrequencyMS: 10000,
    });
    logger.info('MongoDB connected successfully');
    mongoRetryCount = 0;
    
    // Start schedulers after DB connection
    orderScheduler.start();
    dailyCleanup.start();
    categoryScheduler.start();
    menuItemScheduler.start();
    orderCleanup.start();
    cartCleanup.startCartCleanupScheduler();
    catalogReviewPoller.start();
    catalogRatingSync.start();
    orderReconciliation.start();
    outboundRetryWorker.start();
    dashboardStatsSync.start();
    pushTokenCleanup.start();
    offerScheduler.start();
    
    // Run one-time startup reconciliation to catch orders missed during downtime
    orderReconciliation.reconcileOrders().then(result => {
      if (result.reconciled > 0) {
        logger.info('[Startup] Reconciled orders missed during downtime', { reconciled: result.reconciled });
      }
    }).catch(err => {
      logger.warn('[Startup] Reconciliation check failed', { error: err.message });
    });
    
    // Initialize Google Sheets - auto-create missing sheets, then initialize headers
    logger.info('Initializing Google Sheets...');
    await googleSheets.ensureAllSheetsExist();
    await googleSheets.initializeDailyReportsSheet();
    await googleSheets.initializeDashboardStatsSheet();
    await googleSheets.initializeCustomersSheet();
    logger.info('Google Sheets initialized');

    // Initialize WhatsApp Flows (category selection)
    try {
      const catalogService = require('./services/catalogService');
      if (catalogService.isEnabled() && !catalogService.getCategoryFlowId()) {
        logger.info('Setting up WhatsApp Category Flow...');
        const result = await catalogService.setupCategoryFlow();
        logger.info('WhatsApp Category Flow initialized', { flowId: result.flowId, status: result.status });
      } else if (catalogService.getCategoryFlowId()) {
        logger.info('WhatsApp Category Flow already configured', { flowId: catalogService.getCategoryFlowId() });
      }
    } catch (flowErr) {
      logger.warn('WhatsApp Category Flow setup skipped', { error: flowErr.message });
    }

    // Initialize WhatsApp Flows (welcome service selection)
    try {
      const catalogService = require('./services/catalogService');
      if (!catalogService.getWelcomeFlowId()) {
        logger.info('Setting up WhatsApp Welcome Flow...');
        const result = await catalogService.setupWelcomeFlow();
        logger.info('WhatsApp Welcome Flow initialized', { flowId: result.flowId, status: result.status });
      } else {
        logger.info('WhatsApp Welcome Flow already configured', { flowId: catalogService.getWelcomeFlowId() });
      }
    } catch (flowErr) {
      logger.warn('WhatsApp Welcome Flow setup skipped', { error: flowErr.message });
    }

    // Initialize WhatsApp Flows (account details form)
    try {
      const catalogService = require('./services/catalogService');
      if (!catalogService.getAccountFlowId()) {
        logger.info('Setting up WhatsApp Account Flow...');
        const result = await catalogService.setupAccountFlow();
        logger.info('WhatsApp Account Flow initialized', { flowId: result.flowId, status: result.status });
      } else {
        logger.info('WhatsApp Account Flow already configured', { flowId: catalogService.getAccountFlowId() });
      }
    } catch (flowErr) {
      logger.warn('WhatsApp Account Flow setup skipped', { error: flowErr.message });
    }

    // Initialize WhatsApp Flows (delivery address form)
    try {
      const catalogService = require('./services/catalogService');
      if (!catalogService.getAddressFlowId()) {
        logger.info('Setting up WhatsApp Address Flow...');
        const result = await catalogService.setupAddressFlow();
        logger.info('WhatsApp Address Flow initialized', { flowId: result.flowId, status: result.status });
      } else {
        logger.info('WhatsApp Address Flow already configured', { flowId: catalogService.getAddressFlowId() });
      }
    } catch (flowErr) {
      logger.warn('WhatsApp Address Flow setup skipped', { error: flowErr.message });
    }

    // Initialize WhatsApp Flows (cart review)
    try {
      const catalogService = require('./services/catalogService');
      if (!catalogService.getCartReviewFlowId()) {
        logger.info('Setting up WhatsApp Cart Review Flow...');
        const result = await catalogService.setupCartReviewFlow();
        logger.info('WhatsApp Cart Review Flow initialized', { flowId: result.flowId, status: result.status });
      } else {
        logger.info('WhatsApp Cart Review Flow already configured', { flowId: catalogService.getCartReviewFlowId() });
      }
    } catch (flowErr) {
      logger.warn('WhatsApp Cart Review Flow setup skipped', { error: flowErr.message });
    }
  } catch (err) {
    mongoRetryCount++;
    const delayMs = Math.min(MONGO_BASE_DELAY * Math.pow(2, Math.min(mongoRetryCount - 1, 5)), 160000);
    logger.error('MongoDB connection error', {
      error: err.message,
      stack: err.stack,
      attempt: mongoRetryCount,
      maxRetries: MONGO_MAX_RETRIES,
      nextRetryDelayMs: delayMs,
      backoffStrategy: 'exponential'
    });
    if (mongoRetryCount >= MONGO_MAX_RETRIES) {
      logger.error('MongoDB max retries exhausted, stopping reconnection', {
        attempt: mongoRetryCount,
        maxRetries: MONGO_MAX_RETRIES
      });
      return;
    }
    logger.info('Retrying MongoDB connection', { attempt: mongoRetryCount, maxRetries: MONGO_MAX_RETRIES, delayMs });
    setTimeout(connectMongoDB, delayMs);
  }
};

// MongoDB connection event handlers
mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected. Attempting reconnect...');
});

mongoose.connection.on('reconnected', () => {
  logger.info('MongoDB reconnected successfully');
});

mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error', { error: err.message });
});

if (process.env.NODE_ENV !== 'test') {
  connectMongoDB();
}

app.use('/api/auth', authRoutes);
app.use('/api/admins', adminsRoutes);
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
app.use('/api/flow-images', flowImagesRoutes);
app.use('/api/delivery', deliveryBoyRoutes);
app.use('/api/hero-sections', heroSectionRoutes);
app.use('/api/offers', offersRoutes);
app.use('/api/whatsapp-broadcast', whatsappBroadcastRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/catalog', catalogRoutes);
app.use('/api/whatsapp-flow', flowEndpointRoutes);

// Health check routes (comprehensive readiness/liveness checks)
app.use('/health', healthRoutes);

// Root route - API status
app.get('/', (req, res) => res.json({ 
  status: 'ok', 
  message: 'FoodAdmin API is running',
  version: '1.0.0'
}));

// Public SSE endpoint for real-time menu/offers updates (no auth required)
const publicSseClients = new Set();

app.get('/api/public/events', (req, res) => {
  const { normalizeOrigin, getAllowedOrigins } = require('./config/corsConfig');
  const requestOrigin = req.get('origin');
  const normalizedOrigin = normalizeOrigin(requestOrigin);
  const allowedOrigins = getAllowedOrigins();

  if (requestOrigin) {
    if (allowedOrigins.includes(normalizedOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  publicSseClients.add(res);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    publicSseClients.delete(res);
  });
});

// SSE endpoint for real-time updates (authenticated)
const sseClients = new Set();
const { initContext, runWithContext } = require('./services/correlationContext');

app.get('/api/events', (req, res) => {
  // Set CORS headers explicitly for Server-Sent Events (EventSource connections)
  const { normalizeOrigin, getAllowedOrigins } = require('./config/corsConfig');
  const requestOrigin = req.get('origin');
  
  if (requestOrigin) {
    const normalizedOrigin = normalizeOrigin(requestOrigin);
    const allowedOrigins = getAllowedOrigins();
    if (allowedOrigins.includes(normalizedOrigin)) {
      res.setHeader('Access-Control-Allow-Origin', requestOrigin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  } else {
    // EventSource may not send Origin header — allow based on Referer or allow all for SSE
    const referer = req.get('referer');
    if (referer) {
      try {
        const refOrigin = new URL(referer).origin;
        const allowedOrigins = getAllowedOrigins();
        if (allowedOrigins.includes(normalizeOrigin(refOrigin))) {
          res.setHeader('Access-Control-Allow-Origin', refOrigin);
          res.setHeader('Access-Control-Allow-Credentials', 'true');
        }
      } catch { /* ignore */ }
    }
  }
  
  // Require valid JWT for SSE connection
  const token = req.query.token || req.headers.authorization?.split(' ')[1];
  if (!token) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(401).json({ error: 'Authentication required' });
  }
  let decoded;
  try {
    decoded = require('jsonwebtoken').verify(token, process.env.JWT_SECRET);
  } catch (err) {
    res.setHeader('Content-Type', 'application/json');
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  const ctx = initContext(null, { source: 'sse', userId: decoded.id || 'unknown' });
  runWithContext(ctx, () => {
    logger.info('SSE connection established', { userId: decoded.id });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    sseClients.add(res);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
      logger.info('SSE connection closed', { userId: decoded.id });
    });
  });
});

// Broadcast to all SSE clients (authenticated)
const broadcast = (data) => {
  const payload = typeof data === 'string' ? { type: data } : data;
  sseClients.forEach(c => c.write(`data: ${JSON.stringify(payload)}\n\n`));
};

// Broadcast to public SSE clients (menu/offers only)
const broadcastPublic = (data) => {
  const payload = typeof data === 'string' ? { type: data } : data;
  publicSseClients.forEach(c => c.write(`data: ${JSON.stringify(payload)}\n\n`));
};

dataEvents.on('orders', () => broadcast('orders'));
dataEvents.on('dashboard', () => broadcast('dashboard'));
dataEvents.on('customers', () => broadcast('customers'));
dataEvents.on('menu', () => { broadcast('menu'); broadcastPublic('menu'); });
dataEvents.on('deliveryboys', () => broadcast('deliveryboys'));
dataEvents.on('offers', () => { broadcast('offers'); broadcastPublic('offers'); });

// Also listen for dataUpdate events (alternative format used in some routes)
dataEvents.on('dataUpdate', (data) => {
  if (data && data.type) {
    broadcast(data);
    // Forward menu/offers updates to public clients too
    if (data.type === 'menu' || data.type === 'offers') {
      broadcastPublic(data);
    }
  }
});

// Admin-only Google Sheets sync routes (protected)
const authMiddleware = require('./middleware/auth');

app.get('/api/admin/test-sheets/:orderId/:status', authMiddleware, async (req, res) => {
  const { orderId, status } = req.params;
  try {
    const result = await googleSheets.updateOrderStatus(orderId, status, status === 'cancelled' ? 'cancelled' : null);
    res.json({ success: result, orderId, status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/sync-cancelled', authMiddleware, async (req, res) => {
  const Order = require('./models/Order');
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

// Global error handler (must be LAST middleware)
app.use(errorHandler);

const PORT = process.env.PORT || 5000;
let server;
if (process.env.NODE_ENV !== 'test') {
  server = app.listen(PORT, () => {
    logger.info('Server started', { port: PORT, env: process.env.NODE_ENV || 'development' });
  });
}

// ============ GRACEFUL SHUTDOWN ============
const SHUTDOWN_TIMEOUT = 15000; // 15 seconds max
let isShuttingDown = false;
const shutdownState = require('./services/shutdownState');

const gracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  shutdownState.setShuttingDown();
  logger.info('Graceful shutdown initiated', { signal });

  // Stop accepting new connections
  if (server) {
    server.close(() => {
      logger.info('HTTP server closed - no longer accepting connections');
    });
  }

  // Close SSE connections
  sseClients.forEach(client => {
    try { client.end(); } catch (e) { /* ignore */ }
  });
  sseClients.clear();
  logger.info('SSE clients disconnected');

  // Stop schedulers
  try {
    if (orderScheduler.stop) orderScheduler.stop();
    if (dailyCleanup.stop) dailyCleanup.stop();
    if (categoryScheduler.stop) categoryScheduler.stop();
    if (menuItemScheduler.stop) menuItemScheduler.stop();
    if (orderCleanup.stop) orderCleanup.stop();
    if (cartCleanup.stopCartCleanupScheduler) cartCleanup.stopCartCleanupScheduler();
    if (catalogRatingSync.stop) catalogRatingSync.stop();
    if (orderReconciliation.stop) orderReconciliation.stop();
    if (outboundRetryWorker.stop) outboundRetryWorker.stop();
    if (dashboardStatsSync.stop) dashboardStatsSync.stop();
    if (pushTokenCleanup.stop) pushTokenCleanup.stop();
    if (offerScheduler.stop) offerScheduler.stop();
    logger.info('Schedulers stopped');
  } catch (err) {
    logger.error('Error stopping schedulers', { error: err.message });
  }

  // Close MongoDB connection
  try {
    await mongoose.connection.close();
    logger.info('MongoDB connection closed');
  } catch (err) {
    logger.error('Error closing MongoDB', { error: err.message });
  }

  // Close Redis connection
  try {
    const redis = require('./services/redis');
    if (redis.shutdown) await redis.shutdown();
    logger.info('Redis connection closed');
  } catch (err) {
    // Redis might not be initialized
    logger.warn('Redis close skipped', { error: err.message });
  }

  // Close message queue
  try {
    const messageQueue = require('./services/messageQueue');
    if (messageQueue.shutdown) await messageQueue.shutdown();
    logger.info('Message queue closed');
  } catch (err) {
    logger.warn('Message queue close skipped', { error: err.message });
  }

  logger.info('Graceful shutdown complete');
  process.exit(0);
};

// Force exit after timeout
const forceShutdown = (signal) => {
  setTimeout(() => {
    logger.error('Forced shutdown after ms timeout', { SHUTDOWN_TIMEOUT });
    process.exit(1);
  }, SHUTDOWN_TIMEOUT).unref();
  gracefulShutdown(signal);
};

process.on('SIGTERM', () => forceShutdown('SIGTERM'));
process.on('SIGINT', () => forceShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  forceShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason: reason?.message || reason, stack: reason?.stack });
  forceShutdown('unhandledRejection');
});

module.exports = { app, server };

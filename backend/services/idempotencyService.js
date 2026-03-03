/**
 * Idempotency Service
 * 
 * Purpose: Prevent duplicate processing of operations
 * - Outbound message deduplication (same content to same phone)
 * - Business operation deduplication (cart operations, order placement)
 * - Request-level idempotency using correlation IDs
 * 
 * Strategy: MongoDB-backed atomic check-and-insert (eliminates TOCTOU gap).
 * Falls back to in-memory cache when MongoDB is unavailable.
 * 
 * MongoDB advantages over pure in-memory:
 * - Survives process restarts
 * - Works across multiple instances (horizontal scaling)
 * - Atomic upsert eliminates TOCTOU gap between isDuplicate() and mark()
 * - TTL index provides automatic cleanup
 */

const crypto = require('crypto');
const mongoose = require('mongoose');
const IdempotencyKey = require('../models/IdempotencyKey');

// In-memory fallback cache (used when MongoDB unavailable)
const idempotencyCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Generate idempotency key from operation parameters
 */
function generateKey(namespace, ...params) {
  const content = params.map(p => 
    typeof p === 'object' ? JSON.stringify(p) : String(p)
  ).join('|');
  
  const hash = crypto
    .createHash('sha256')
    .update(content)
    .digest('hex')
    .substring(0, 16);
  
  return `${namespace}:${hash}`;
}

/**
 * Check if MongoDB is connected
 */
function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}

/**
 * Atomic check-and-mark using MongoDB (eliminates TOCTOU gap)
 * Returns true if the key already existed (duplicate), false if newly inserted.
 */
async function atomicCheckAndMark(key, namespace, ttlMs) {
  try {
    const expiresAt = new Date(Date.now() + ttlMs);
    
    // findOneAndUpdate with upsert: if key doesn't exist, insert it.
    // If it already exists, return the existing doc (no update needed).
    const existing = await IdempotencyKey.findOneAndUpdate(
      { key },
      { $setOnInsert: { key, namespace, processedAt: new Date(), expiresAt } },
      { upsert: true, new: false, rawResult: true }
    );
    
    // If existing.value is null, the document was newly inserted (not a duplicate)
    // If existing.value is not null, the key already existed (duplicate)
    return existing.value !== null;
  } catch (err) {
    // E11000 duplicate key error means another process inserted simultaneously — it's a duplicate
    if (err.code === 11000) {
      return true;
    }
    throw err;
  }
}

/**
 * Check if operation is duplicate (in-memory fallback)
 */
function isDuplicate(key) {
  const entry = idempotencyCache.get(key);
  
  if (!entry) return false;
  
  // Check if expired
  if (Date.now() > entry.expiresAt) {
    idempotencyCache.delete(key);
    return false;
  }
  
  return true;
}

/**
 * Mark operation as processed (in-memory fallback)
 */
function markProcessed(key, ttlMs = CACHE_TTL) {
  idempotencyCache.set(key, {
    processedAt: Date.now(),
    expiresAt: Date.now() + ttlMs
  });
}

/**
 * Clean expired entries (called periodically for in-memory cache)
 */
function cleanExpired() {
  const now = Date.now();
  for (const [key, entry] of idempotencyCache.entries()) {
    if (now > entry.expiresAt) {
      idempotencyCache.delete(key);
    }
  }
}

// Clean every minute (unref so it doesn't block process exit in tests)
const cleanupInterval = setInterval(cleanExpired, 60 * 1000);
cleanupInterval.unref();

/**
 * Outbound message idempotency
 * Prevents sending duplicate messages to same phone with same content
 */
function checkOutboundMessage(phone, messageType, content) {
  const key = generateKey('outbound', phone, messageType, content);
  const ttlMs = 1 * 60 * 1000; // 1 min TTL for messages
  
  if (isMongoConnected()) {
    return {
      get isDuplicate() {
        // For backward compatibility — callers should use checkAsync() instead
        return isDuplicate(key);
      },
      mark: () => markProcessed(key, ttlMs),
      checkAsync: async () => atomicCheckAndMark(key, 'outbound', ttlMs)
    };
  }
  
  return {
    isDuplicate: isDuplicate(key),
    mark: () => markProcessed(key, ttlMs)
  };
}

/**
 * Cart operation idempotency
 * Prevents duplicate add/remove operations
 */
function checkCartOperation(customerId, operation, itemId, quantity = 1) {
  const key = generateKey('cart', customerId, operation, itemId, quantity);
  const ttlMs = 30 * 1000; // 30 sec TTL for cart ops
  
  if (isMongoConnected()) {
    return {
      get isDuplicate() {
        return isDuplicate(key);
      },
      mark: () => {
        markProcessed(key, ttlMs);
        // Also persist to MongoDB (fire and forget)
        atomicCheckAndMark(key, 'cart', ttlMs).catch(() => {});
      },
      checkAsync: async () => atomicCheckAndMark(key, 'cart', ttlMs)
    };
  }
  
  return {
    isDuplicate: isDuplicate(key),
    mark: () => markProcessed(key, ttlMs)
  };
}

/**
 * Order operation idempotency
 * Prevents duplicate order placement.
 * Uses atomic MongoDB check-and-mark when available.
 */
function checkOrderOperation(customerId, operation, orderData) {
  const key = generateKey('order', customerId, operation, orderData);
  const ttlMs = 1 * 60 * 1000; // 1 min TTL for orders
  
  if (isMongoConnected()) {
    // Return object with async check for callers that support it
    let _cachedResult = null;
    return {
      get isDuplicate() {
        // Synchronous check from in-memory (fast path with possible false-negative)
        return isDuplicate(key);
      },
      mark: () => {
        markProcessed(key, ttlMs);
        // Also persist to MongoDB (fire and forget)
        atomicCheckAndMark(key, 'order', ttlMs).catch(() => {});
      },
      /**
       * Atomic check — atomically inserts key or returns duplicate.
       * Eliminates TOCTOU gap. Returns true if duplicate.
       */
      checkAsync: async () => {
        if (_cachedResult !== null) return _cachedResult;
        _cachedResult = await atomicCheckAndMark(key, 'order', ttlMs);
        // Also update in-memory for fast subsequent checks
        if (_cachedResult) {
          markProcessed(key, ttlMs);
        }
        return _cachedResult;
      }
    };
  }
  
  // Fallback: in-memory only
  return {
    isDuplicate: isDuplicate(key),
    mark: () => markProcessed(key, ttlMs)
  };
}

/**
 * Generic operation idempotency
 */
function checkOperation(namespace, ...params) {
  const key = generateKey(namespace, ...params);
  
  if (isMongoConnected()) {
    return {
      get isDuplicate() {
        return isDuplicate(key);
      },
      mark: () => {
        markProcessed(key);
        atomicCheckAndMark(key, namespace, CACHE_TTL).catch(() => {});
      },
      checkAsync: async () => atomicCheckAndMark(key, namespace, CACHE_TTL)
    };
  }
  
  return {
    isDuplicate: isDuplicate(key),
    mark: () => markProcessed(key)
  };
}

/**
 * Correlation ID generation for request tracing
 */
function generateCorrelationId() {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Get cache statistics
 */
function getStats() {
  const now = Date.now();
  let active = 0;
  let expired = 0;
  
  for (const [, entry] of idempotencyCache.entries()) {
    if (now > entry.expiresAt) {
      expired++;
    } else {
      active++;
    }
  }
  
  return {
    total: idempotencyCache.size,
    active,
    expired,
    cacheTtlMs: CACHE_TTL,
    mongoConnected: isMongoConnected()
  };
}

module.exports = {
  generateKey,
  isDuplicate,
  markProcessed,
  atomicCheckAndMark,
  checkOutboundMessage,
  checkCartOperation,
  checkOrderOperation,
  checkOperation,
  generateCorrelationId,
  getStats,
  cleanExpired
};

const mongoose = require('mongoose');

/**
 * IdempotencyKey Model
 * 
 * MongoDB-backed idempotency store. Uses a unique index on `key` for
 * atomic check-and-insert (eliminates TOCTOU gap).
 * TTL index auto-expires entries after the configured duration.
 * 
 * Works across restarts and multiple instances.
 */
const idempotencyKeySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true
  },
  namespace: {
    type: String,
    required: true
  },
  processedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 }  // TTL index — MongoDB auto-deletes when expiresAt is reached
  }
});

// Compound index for efficient lookups by namespace
idempotencyKeySchema.index({ namespace: 1, processedAt: -1 });

module.exports = mongoose.model('IdempotencyKey', idempotencyKeySchema);

/**
 * Shutdown State
 * 
 * Shared module so middleware and route handlers can check if the
 * process is shutting down and return 503 for retryable requests
 * (webhooks, payment callbacks) instead of processing them mid-shutdown.
 */

let _isShuttingDown = false;

module.exports = {
  get isShuttingDown() {
    return _isShuttingDown;
  },
  setShuttingDown() {
    _isShuttingDown = true;
  }
};

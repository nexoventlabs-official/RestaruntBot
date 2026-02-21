/**
 * Message Retry Scheduler
 * 
 * Purpose: Automatically retry failed inbound messages
 * Runs every 5 minutes to check for retryable failures
 */

const cron = require('node-cron');
const logger = require('./logger');
const messageProcessor = require('./messageProcessor');

let schedulerTask = null;

/**
 * Recover messages stuck in 'processing' for over 5 minutes.
 * These are messages where the webhook set status to 'processing'
 * but the handler crashed or never completed.
 */
async function recoverStuckMessages(maxAgeMinutes = 5, batchSize = 20) {
  const InboundMessage = require('../models/InboundMessage');
  const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  try {
    const result = await InboundMessage.updateMany(
      {
        status: 'processing',
        receivedAt: { $lt: cutoff }
      },
      {
        $set: {
          status: 'failed',
          error: {
            message: 'Message stuck in processing state — recovered by scheduler',
            code: 'STUCK_PROCESSING',
            isRetryable: true
          }
        }
      }
    );

    if (result.modifiedCount > 0) {
      logger.info('[RetryScheduler] Recovered stuck messages', { count: result.modifiedCount });
    }
    return result.modifiedCount;
  } catch (error) {
    logger.error('[RetryScheduler] Stuck message recovery error', { error: error.message });
    return 0;
  }
}

/**
 * Start the retry scheduler
 */
function start() {
  if (schedulerTask) {
    logger.info('⚠️ [RetryScheduler] Already running');
    return;
  }
  
  // Run every 5 minutes
  schedulerTask = cron.schedule('*/5 * * * *', async () => {
    logger.info('🔄 [RetryScheduler] Running retry job...');
    
    try {
      // Step 1: Recover stuck 'processing' messages (> 5 min old)
      await recoverStuckMessages(5, 20);

      // Step 2: Retry failed retryable messages
      const result = await messageProcessor.retryFailedMessages(3, 10);
      
      if (result.retried > 0) {
        logger.info('[RetryScheduler] Completed: succeeded, failed', { succeeded: result.succeeded, failed: result.failed });
      }
    } catch (error) {
      logger.error('❌ [RetryScheduler] Error:', error.message);
    }
  });
  
  logger.info('✅ [RetryScheduler] Started - running every 5 minutes');
}

/**
 * Stop the retry scheduler
 */
function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('🛑 [RetryScheduler] Stopped');
  }
}

module.exports = {
  start,
  stop,
  recoverStuckMessages
};

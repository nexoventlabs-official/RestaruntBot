/**
 * Message Retry Scheduler
 * 
 * Purpose: Automatically retry failed inbound messages
 * Runs every 5 minutes to check for retryable failures
 */

const cron = require('node-cron');
const messageProcessor = require('./messageProcessor');

let schedulerTask = null;

/**
 * Start the retry scheduler
 */
function start() {
  if (schedulerTask) {
    console.log('⚠️ [RetryScheduler] Already running');
    return;
  }
  
  // Run every 5 minutes
  schedulerTask = cron.schedule('*/5 * * * *', async () => {
    console.log('🔄 [RetryScheduler] Running retry job...');
    
    try {
      const result = await messageProcessor.retryFailedMessages(3, 10);
      
      if (result.retried > 0) {
        console.log(`✅ [RetryScheduler] Completed: ${result.succeeded} succeeded, ${result.failed} failed`);
      }
    } catch (error) {
      console.error('❌ [RetryScheduler] Error:', error.message);
    }
  });
  
  console.log('✅ [RetryScheduler] Started - running every 5 minutes');
}

/**
 * Stop the retry scheduler
 */
function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    console.log('🛑 [RetryScheduler] Stopped');
  }
}

module.exports = {
  start,
  stop
};

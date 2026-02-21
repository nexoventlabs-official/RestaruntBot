/**
 * Outbound Message Retry Worker
 * 
 * Purpose: Consume failed WhatsApp messages that are marked as retryable.
 * The OutboundMessage model has isRetryable, nextRetryAt, retryCount, maxRetries
 * fields — this worker reads due records and retries them.
 * 
 * Runs every 2 minutes:
 * 1. Queries OutboundMessage where status='failed', isRetryable=true, nextRetryAt <= now
 * 2. Re-sends via the appropriate WhatsApp method (using metaCloud directly)
 * 3. Updates status to 'sent' on success, increments retryCount on failure
 * 4. Marks as permanent failure if retryCount >= maxRetries
 */

const cron = require('node-cron');
const OutboundMessage = require('../models/OutboundMessage');
const metaCloud = require('./metaCloud');
const logger = require('./logger');
const { initContext, runWithContext } = require('./correlationContext');

let schedulerTask = null;

/**
 * Process retryable failed messages
 */
async function processRetries() {
  try {
    const now = new Date();

    // Find messages due for retry (limit batch to avoid overloading Meta API)
    const failedMessages = await OutboundMessage.find({
      status: 'failed',
      isRetryable: true,
      nextRetryAt: { $lte: now },
      retryCount: { $lt: 3 } // Hard cap even if maxRetries differs
    })
    .sort({ nextRetryAt: 1 })
    .limit(10);

    if (failedMessages.length === 0) return { retried: 0 };

    logger.info('[OutboundRetry] Processing failed messages', {
      count: failedMessages.length
    });

    let succeeded = 0;
    let failed = 0;

    for (const msg of failedMessages) {
      try {
        // Determine the send method based on messageType
        let response;
        const phone = msg.phone;
        const content = msg.content;

        switch (msg.messageType) {
          case 'text':
            response = await metaCloud.sendMessage(phone, content?.text || 'Message retry');
            break;
          case 'buttons':
            response = await metaCloud.sendButtons(phone, content?.text || '', content?.buttons || []);
            break;
          case 'image':
            if (content?.buttons?.length) {
              response = await metaCloud.sendImageWithButtons(phone, content?.imageUrl, content?.text || '', content?.buttons);
            } else {
              response = await metaCloud.sendImage(phone, content?.imageUrl, content?.text || '');
            }
            break;
          case 'cta_url':
            response = await metaCloud.sendCtaUrl(phone, content?.text || '', 'Open', content?.url || '');
            break;
          default:
            // For complex message types (order_details, product_list, etc.),
            // skip retry — they require full context that isn't stored in content
            logger.info('[OutboundRetry] Skipping non-retryable type', {
              messageType: msg.messageType,
              id: msg._id
            });
            msg.isRetryable = false;
            msg.failureReason = 'unsupported_message_type';
            await msg.save();
            continue;
        }

        // Success! Update the record
        const prevStatus = msg.status;
        msg.status = 'sent';
        msg.sentAt = new Date();
        msg.lastRetryAt = new Date();
        msg.metaMessageId = response?.messages?.[0]?.id || response?.id;
        msg.metaResponse = { code: 'success', timestamp: new Date(), message: 'Sent via retry worker' };
        await msg.save();

        succeeded++;
        logger.info('state_transition', {
          entity: 'outbound_message',
          from: prevStatus,
          to: 'sent',
          trigger: 'retry_worker',
          phone,
          messageType: msg.messageType,
          attempt: (msg.retryCount || 0) + 1,
          maxRetries: msg.maxRetries || 3
        });

      } catch (retryErr) {
        // Failed again — increment retry count
        msg.retryCount = (msg.retryCount || 0) + 1;
        msg.lastRetryAt = new Date();

        if (msg.retryCount >= (msg.maxRetries || 3)) {
          // Exhausted retries — mark as permanent failure
          msg.isRetryable = false;
          msg.failureReason = msg.failureReason || 'unknown';
          logger.warn('[OutboundRetry] Message exhausted retries', {
            phone: msg.phone,
            attempt: msg.retryCount,
            maxRetries: msg.maxRetries || 3,
            reason: retryErr.message,
            backoffStrategy: 'exponential'
          });
          logger.info('state_transition', {
            entity: 'outbound_message',
            from: 'failed',
            to: 'permanent_failure',
            trigger: 'retry_exhausted',
            phone: msg.phone,
            attempt: msg.retryCount
          });
        } else {
          // Schedule next retry with exponential backoff
          msg.nextRetryAt = msg.calculateNextRetry();
          const delayMs = msg.nextRetryAt.getTime() - Date.now();
          logger.info('[OutboundRetry] Message retry failed, scheduling next', {
            phone: msg.phone,
            attempt: msg.retryCount,
            maxRetries: msg.maxRetries || 3,
            nextRetryAt: msg.nextRetryAt.toISOString(),
            delayMs,
            backoffStrategy: 'exponential'
          });
        }

        msg.error = {
          message: retryErr.message,
          code: retryErr.code || retryErr.error?.code,
          httpStatus: retryErr.response?.status
        };
        await msg.save();

        failed++;
      }
    }

    return { retried: failedMessages.length, succeeded, failed };
  } catch (error) {
    logger.error('[OutboundRetry] Fatal error', { error: error.message, stack: error.stack });
    return { retried: 0, error: error.message };
  }
}

/**
 * Start the retry worker
 */
function start() {
  if (schedulerTask) {
    logger.info('[OutboundRetry] Already running');
    return;
  }

  // Run every 2 minutes
  schedulerTask = cron.schedule('*/2 * * * *', async () => {
    const ctx = initContext(null, { source: 'scheduler', job: 'outboundRetryWorker' });
    await runWithContext(ctx, async () => {
      const result = await processRetries();
      if (result.retried > 0) {
        logger.info('[OutboundRetry] Cycle completed', {
          processed: result.retried,
          succeeded: result.succeeded,
          failed: result.failed
        });
      }
    });
  });

  logger.info('[OutboundRetry] Started — running every 2 minutes');
}

/**
 * Stop the retry worker
 */
function stop() {
  if (schedulerTask) {
    schedulerTask.stop();
    schedulerTask = null;
    logger.info('[OutboundRetry] Stopped');
  }
}

module.exports = {
  start,
  stop,
  processRetries // Exported for testing
};

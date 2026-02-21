/**
 * Message Processing Dedup Fix Verification Tests
 *
 * Validates fixes for Section 5 of CONCURRENCY_IDEMPOTENCY_AUDIT.md:
 * 1. Null messageId — synthetic ID generated via crypto hash
 * 2. Stuck 'processing' messages — status transitions to 'processed'/'failed'
 * 3. Stuck message recovery — scheduler recovers 'processing' messages > 5 min old
 */

jest.mock('../../services/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../services/correlationContext', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

const fs = require('fs');
const path = require('path');

const webhookSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'routes', 'webhook.js'), 'utf8'
);

const retrySchedulerSrc = fs.readFileSync(
  path.join(__dirname, '..', '..', 'services', 'messageRetryScheduler.js'), 'utf8'
);

// ── 1. Null messageId synthetic ID ──────────────────────────────

describe('Null messageId dedup', () => {
  it('webhook.js imports crypto', () => {
    expect(webhookSrc).toMatch(/require\s*\(\s*['"]crypto['"]\s*\)/);
  });

  it('generates synthetic messageId when message.id is missing', () => {
    // Should have code path for generating synthetic ID
    expect(webhookSrc).toContain('synthetic_');
    expect(webhookSrc).toMatch(/createHash\s*\(\s*['"]sha256['"]\s*\)/);
  });

  it('logs warning for synthetic messageId', () => {
    expect(webhookSrc).toContain('Message missing id, generated synthetic messageId');
  });

  it('always creates InboundMessage (no if-messageId gate)', () => {
    // The old code had: if (messageId) { ... create InboundMessage ... }
    // The new code should NOT have this gate — dedup always runs
    const dedupSection = webhookSrc.substring(
      webhookSrc.indexOf('Deduplicate using InboundMessage'),
      webhookSrc.indexOf('Process message and update status')
    );
    // Should NOT find: if (messageId) {  before the InboundMessage creation
    expect(dedupSection).not.toMatch(/if\s*\(\s*messageId\s*\)\s*\{/);
  });

  it('synthetic ID includes phone + messageType + content + time bucket', () => {
    // Hash should incorporate phone, messageType, content, and Math.floor(Date.now() / 1000) for 1s dedup window
    expect(webhookSrc).toMatch(/phone\s*\+\s*messageType\s*\+\s*contentStr\s*\+\s*Math\.floor/);
    expect(webhookSrc).toContain('Date.now() / 1000');
  });
});

// ── 2. Status transitions (processed / failed) ─────────────────

describe('InboundMessage status lifecycle', () => {
  it('stores InboundMessage reference for later status update', () => {
    // Should have a variable (inboundRecord) that persists outside the try block
    expect(webhookSrc).toContain('let inboundRecord');
  });

  it('marks message as processed after successful handling', () => {
    expect(webhookSrc).toMatch(/status:\s*['"]processed['"]/);
    expect(webhookSrc).toContain('processedAt');
  });

  it('marks message as failed on chatbot error', () => {
    const failedSection = webhookSrc.substring(
      webhookSrc.indexOf('.catch(async'),
      webhookSrc.indexOf('.catch(async') + 600
    );
    expect(failedSection).toMatch(/status:\s*['"]failed['"]/);
    expect(failedSection).toContain('isRetryable');
    expect(failedSection).toContain('CHATBOT_ERROR');
  });

  it('uses atomic InboundMessage.updateOne for status transition', () => {
    // Should use InboundMessage.updateOne instead of inbound.save()
    // to avoid full-doc replace race
    expect(webhookSrc).toMatch(/InboundMessage\.updateOne\s*\(/);
  });

  it('success path uses .then() for status update', () => {
    expect(webhookSrc).toMatch(/\.then\s*\(\s*async\b/);
  });

  it('failure path uses .catch() for status update', () => {
    expect(webhookSrc).toMatch(/\.catch\s*\(\s*async\b/);
  });
});

// ── 3. Stuck message recovery ───────────────────────────────────

describe('Stuck message recovery in scheduler', () => {
  it('exports recoverStuckMessages function', () => {
    expect(retrySchedulerSrc).toContain('recoverStuckMessages');
    expect(retrySchedulerSrc).toMatch(/module\.exports\s*=\s*\{[^}]*recoverStuckMessages/);
  });

  it('recoverStuckMessages finds processing messages older than cutoff', () => {
    expect(retrySchedulerSrc).toContain("status: 'processing'");
    expect(retrySchedulerSrc).toContain('$lt: cutoff');
  });

  it('recoverStuckMessages transitions stuck messages to failed with isRetryable', () => {
    expect(retrySchedulerSrc).toMatch(/status:\s*['"]failed['"]/);
    expect(retrySchedulerSrc).toContain('STUCK_PROCESSING');
    expect(retrySchedulerSrc).toContain('isRetryable: true');
  });

  it('uses InboundMessage.updateMany for batch recovery', () => {
    expect(retrySchedulerSrc).toContain('updateMany');
  });

  it('scheduler cron calls recoverStuckMessages before retryFailedMessages', () => {
    const cronBody = retrySchedulerSrc.substring(
      retrySchedulerSrc.indexOf('cron.schedule'),
      retrySchedulerSrc.indexOf("Started - running every 5 minutes")
    );
    const recoverIdx = cronBody.indexOf('recoverStuckMessages');
    const retryIdx = cronBody.indexOf('retryFailedMessages');
    expect(recoverIdx).toBeGreaterThan(-1);
    expect(retryIdx).toBeGreaterThan(-1);
    expect(recoverIdx).toBeLessThan(retryIdx);
  });

  it('recovery uses configurable maxAgeMinutes parameter', () => {
    expect(retrySchedulerSrc).toMatch(/recoverStuckMessages\s*\(\s*maxAgeMinutes/);
    expect(retrySchedulerSrc).toContain('maxAgeMinutes * 60 * 1000');
  });
});

// ── 4. Unit test: recoverStuckMessages ──────────────────────────

describe('recoverStuckMessages unit test', () => {
  let recoverStuckMessages;

  beforeEach(() => {
    jest.resetModules();
  });

  it('returns count of recovered messages', async () => {
    // Mock InboundMessage.updateMany
    jest.doMock('../../models/InboundMessage', () => ({
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 3 })
    }));
    jest.doMock('node-cron', () => ({ schedule: jest.fn() }));
    jest.doMock('../../services/messageProcessor', () => ({}));

    const scheduler = require('../../services/messageRetryScheduler');
    const result = await scheduler.recoverStuckMessages(5, 20);
    expect(result).toBe(3);
  });

  it('returns 0 on error', async () => {
    jest.doMock('../../models/InboundMessage', () => ({
      updateMany: jest.fn().mockRejectedValue(new Error('DB down'))
    }));
    jest.doMock('node-cron', () => ({ schedule: jest.fn() }));
    jest.doMock('../../services/messageProcessor', () => ({}));

    const scheduler = require('../../services/messageRetryScheduler');
    const result = await scheduler.recoverStuckMessages(5, 20);
    expect(result).toBe(0);
  });
});

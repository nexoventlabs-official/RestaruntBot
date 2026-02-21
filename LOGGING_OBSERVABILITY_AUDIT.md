# Production Reliability Engineer — Logging & Observability Audit

---

## 1. CORRELATION ID PER ORDER

### Architecture
A well-designed `AsyncLocalStorage`-based correlation system exists in `correlationContext.js`. It generates IDs as `<epoch_ms>-<16_hex_chars>`, stores them in async context, auto-attaches them to log entries, propagates via `X-Correlation-ID` header, and wraps request lifecycle with start/finish logs.

### The Fatal Flaw: Two Logger Systems

| Import Pattern | Logger Type | CorrelationId? | Used By |
|---|---|---|---|
| `require('./correlationContext').logger` | Correlation-aware | **YES** | whatsapp.js, transactionManager.js, messageProcessor.js **(4 files)** |
| `require('./logger')` | Raw Winston | **NO** | chatbot.js, payment.js, webhook.js, orderStateMachine.js, razorpay.js, pushNotification.js, errorHandler.js, authenticate.js, metaCloud.js **(12+ files)** |
| `console.log` / `console.error` | Bare stdout | **NO** | googleSheets.js **(124 calls)** |

**Result:** Only **4 out of 16+ files** use the correlation-aware logger. The heaviest files — chatbot.js (207 logger calls), metaCloud.js (50+), payment.js (44), webhook.js (39) — all use raw Winston with zero correlation context.

### Order-Level Correlation
There is **no order-level correlation ID** at all. The correlation system tracks per-HTTP-request context, but:
- An order lifecycle spans **multiple requests** (webhook → chatbot → payment → callback)
- Each request gets a **different** correlationId
- There is no `orderId` auto-attached to context via `setMetadata('orderId', ...)`
- `orderId` appears in only 8 out of 207 chatbot.js log calls, and usually as template literals not structured fields

**Verdict: 2/10** — Infrastructure exists but is unused by 75% of the codebase. No order-level tracing capability.

---

## 2. STRUCTURED LOGGING FORMAT

### Production Format
Winston outputs JSON in production with ISO timestamps, service name, environment, version, and redacted sensitive fields — **correct**.

### Actual Usage: Unstructured Majority

The codebase has three incompatible patterns:

**Pattern A — Template literals (dominant in chatbot.js, payment.js):**
```js
logger.info(`OSRM URL: ${url}`);
logger.info(`Admin push sent for COD order ${orderId}`);
logger.info(`Category fuzzy match: "${text}" → "${bestMatch}" (${Math.round(bestScore * 100)}%)`);
```
**Not queryable.** Can't filter logs by orderId or match score — data is baked into strings.

**Pattern B — Structured objects (minority, in messageProcessor, whatsapp):**
```js
logger.info('Message processed successfully', { messageId, duration });
logger.info('Outbound message sent', { phone, messageType, metaMessageId });
```
**Correct and queryable.**

**Pattern C — console.log with emojis (googleSheets.js, 124 calls):**
```js
console.log(`✅ Order added to Google Sheet (${sheet.sheetName}):`, order.orderId);
console.error('❌ Google Sheets add order error:', error.message);
```
**Bypasses Winston entirely** — no JSON formatting, no file rotation, no redaction. These logs go to raw stdout and are invisible to any log management system.

### Emoji Pollution
Multiple files use emojis in log messages: `❌`, `✅`, `🔍`, `⏰`, `💳`, `📱`, `🔐`. These interfere with log parsing and grep operations.

**Verdict: 3/10** — Winston JSON format in production is correct, but the majority of log calls use unstructured template literals, and an entire service (Google Sheets, 124 calls) bypasses the framework.

---

## 3. STATE TRANSITION LOGS

### Order Status Transitions
`orderStateMachine.js` correctly logs **both valid and invalid transitions** with `from` and `to` states:

```js
// Valid transition
logger.info('Order status transitioned', { orderId, from: previousStatus, to: newStatus });

// Invalid transition
logger.warn('⚠️ Invalid order status transition', { orderId, from, to, reason });
```

### What's Missing

| Gap | Impact |
|---|---|
| **Who triggered the transition** | Can't distinguish admin action vs scheduler vs webhook vs customer |
| **No correlationId** | Can't link transition to the request that caused it |
| **No phone/customerId** | Can't search transitions by customer |
| **Payment status changes NOT logged** | `order.paymentStatus = 'paid'` is a plain assignment with zero logging across all 3 payment endpoints |
| **State machine frequently bypassed** | `orderScheduler` directly sets `order.status = 'cancelled'` — no log from state machine. Same for some chatbot cancellation paths |

### Payment Status — Completely Silent

In `payment.js`, the payment status is changed via:
```js
order.paymentStatus = 'paid';
await order.save();
```
No before→after log. No explicit "payment status transitioned from pending to paid" message. Across verify-upi, webhook, and callback — **none of them log the payment status change itself**.

**Verdict: 3/10** — Order status transitions are logged when the state machine is used, but the state machine is bypassed in key paths, payment status changes are completely unlogged, and there's no actor/context attached.

---

## 4. ERROR CLASSIFICATION

### What Exists

Only **2 out of 16+ files** implement error classification:

**messageProcessor.js** — `classifyError()` with 6 categories:
```
database (retryable) | network (retryable) | policy_violation (permanent)
rate_limit (retryable) | business_logic (permanent) | unknown (retryable)
```

**whatsapp.js / OutboundMessage** — `classifyFailure()`:
```
retryable | policy_violation
```

### What Doesn't Exist

| File | Error Pattern | Classification |
|---|---|---|
| **errorHandler.js** | `logger.error('Error occurred:', { message, stack })` | **None** — binary 500 vs non-500 |
| **chatbot.js** (33 error calls) | `logger.error('Chatbot error', { error: error.message })` | **None** |
| **payment.js** (44 calls) | `logger.error('Payment error', { error: err.message })` | **None** |
| **razorpay.js** | Implicit via retry condition codes | Not surfaced in logs |
| **pushNotification.js** | Implicit via stale token detection | Not surfaced as classification |

### Critical Gap: `err.stack` Suppressed in Production

`errorHandler.js` line 17:
```js
stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
```

**In production, error stack traces are never logged.** An engineer investigating a failure would see `"Something went wrong"` with a message but no stack trace, no file path, no line number.

### `error.code` and `error.name` Never Logged
The central error handler logs `err.message` but not `err.code` (e.g., `ECONNREFUSED`, `11000`, `ETIMEDOUT`) or `err.name` (e.g., `MongoNetworkError`, `ValidationError`). These are critical for automated alerting and classification.

**Verdict: 2/10** — Two files have real classification. The central error handler is the weakest link — no classification, no stack in production, no error code.

---

## 5. EXTERNAL API RESPONSE LOGGING

| Service | HTTP Status? | Response Body? | Duration? | Correlation? |
|---|---|---|---|---|
| **Meta/WhatsApp** (metaCloud.js) | **No** | **Yes** — `error.response?.data` on failure | **No** | **No** |
| **Razorpay** (razorpay.js) | **No** explicit | **Yes** — detailed error fields (`code`, `description`, `source`, `step`, `reason`) | **No** | **No** |
| **Google Sheets** (googleSheets.js) | **No** | **No** — only `error.message` | **No** | **No** (console.log) |
| **Firebase/FCM** (pushNotification.js) | **No** | **Yes** — `error.code` | **No** | **No** |
| **OpenCage Geocoding** (chatbot.js) | **No** | Partial | **No** | **No** |
| **OSRM Routing** (chatbot.js) | **Yes** — `response.data.code` | Partial | **No** | **No** |

### Zero Duration Measurement

Not a single external API call in the entire codebase measures request duration. There is no `startTimer()` / `endTimer()` pattern. The `logger.js` file exports `startTimer()` and `logApiCall()` utility functions, but **no file in the codebase calls them**.

```js
// logger.js exports these — NEVER USED:
logApiCall(service, method, url, statusCode, duration, metadata)
startTimer()
logPerformance(operation, duration, metadata)
```

### Success Response Logging
Most external API calls only log **on failure**. Successful calls are largely silent:
- Razorpay payment link creation: logs result orderId, but not response time or full response
- Meta message send: logs metaMessageId on success, but not HTTP 200 status or response time
- Google Sheets: logs `✅ Order added` on success, but via console.log

**Verdict: 2/10** — Error responses from Razorpay and Meta are logged with good detail. But zero duration measurement, no HTTP status codes, no success response logging, and Google Sheets bypasses the logger entirely.

---

## 6. RETRY LOGGING

| Component | Attempt #? | Delay? | Final Outcome? | Rating |
|---|---|---|---|---|
| **Razorpay refund** (razorpay.js) | ✅ `attempt ${retryCount + 2}/${MAX_RETRIES + 1}` | ✅ `${retryDelay / 1000} seconds` | ✅ success/exhausted | **Excellent** |
| **FCM push** (pushNotification.js) | ✅ `attempt ${attempt + 1}` | ✅ `retrying in ${delay}ms` | ✅ `failed after ${MAX_RETRIES + 1} attempts` | **Excellent** |
| **Transaction retry** (transactionManager.js) | ✅ `{ attempt, maxRetries }` | **No** | ✅ commit/abort logged | Good |
| **Message processor retry** (messageProcessor.js) | ✅ `attempt ${msg.retryCount + 1}` | **No** | ✅ succeeded/failed count | Good |
| **WhatsApp outbound** (whatsapp.js) | **N/A** — no retry logic exists | — | — | **Missing** |
| **MongoDB connection** (server.js) | **No** attempt counter | **No** | **No** | **Missing** |

**Verdict: 5/10** — Razorpay and FCM retry logging is textbook quality. Transaction and message retries are good. But WhatsApp has no retry mechanism at all (despite `OutboundMessage` recording `isRetryable` and `nextRetryAt` — no consumer exists), and MongoDB reconnection is silent.

---

## 7. TRACING A FAILED ORDER — Step-by-Step

**Scenario:** Customer reports "I paid but got no confirmation." Engineer investigates.

### What the Engineer Would Do

**Step 1: Find the order in MongoDB**
```js
db.orders.findOne({ "customer.phone": "919876543210", status: "pending" })
```
Finds order with `orderId: "ORD_ABC123"`, `paymentStatus: "pending"`, `razorpayOrderId: "plink_xyz"`.

**Step 2: Search logs for the orderId**
```bash
grep "ORD_ABC123" logs/combined-2026-02-20.log
```
**PROBLEM:** Order creation in `processCODOrder` and `processCheckout` does NOT log the orderId at creation time. The only hits might be from `orderStateMachine` if `transitionStatus()` was called, or from payment.js if the verify-upi path was reached.

**Step 3: Try to find the correlationId**
```bash
# Can't — there's no orderId→correlationId mapping
# The correlation middleware logged "Request started" and "Request completed" but
# chatbot.js (where order was created) uses raw Winston with NO correlationId
```
**DEAD END.** The request that created this order has no correlationId in any of its 207 logger calls.

**Step 4: Search by phone number**
```bash
grep "919876543210" logs/combined-2026-02-20.log
```
Finds ~12 chatbot.js logs that include phone. But most chatbot logs don't include phone. The engineer sees fragmented entries with no way to connect them.

**Step 5: Check Razorpay webhook logs**
```bash
grep "plink_xyz" logs/combined-2026-02-20.log
```
If the webhook fired, finds the PaymentEvent dedup log. But webhook.js uses raw Winston — no correlationId. Can't link the webhook to the original checkout request.

**Step 6: Check for WhatsApp delivery**
```bash
# OutboundMessage collection
db.outboundMessages.find({ phone: "919876543210", createdAt: { $gte: today } })
```
May find a failed message record with `isRetryable: true`, `nextRetryAt: <timestamp>`. But the `nextRetryAt` is never consumed by any worker, so the message was never retried.

**Step 7: Check Google Sheets**
```bash
grep "ORD_ABC123" logs/combined-2026-02-20.log
# NOTHING — Google Sheets uses console.log, not Winston
# These logs are lost unless stdout was captured externally
```
**IMPOSSIBLE** to determine if the Google Sheets entry was written.

**Step 8: Check push notifications**
```bash
grep "push" logs/combined-2026-02-20.log | grep "ORD_ABC123"
# NOTHING — push notification logs don't include orderId
```
**IMPOSSIBLE** to determine if admin was notified for this specific order.

### Summary of Trace Attempt

| Step | Can engineer find it? | Reason |
|---|---|---|
| Find order in DB | ✅ | MongoDB query |
| Find order creation log | **NO** | Not logged (except pickup orders) |
| Find correlationId | **NO** | chatbot.js uses raw Winston |
| Link webhook to order | **Partial** | razorpayOrderId searchable, but no correlation |
| Verify WhatsApp delivered | **Partial** | OutboundMessage in DB, but no log linkage |
| Verify Google Sheets | **NO** | console.log bypasses Winston |
| Verify push notification | **NO** | No orderId in push logs |
| Determine root cause of failure | **Unlikely** | No stack trace in production, no error classification |

**An engineer investigating a failed order would need to manually query 4+ MongoDB collections and grep disconnected log files with no shared identifier linking them. Average investigation time: 30–60 minutes for a competent engineer.**

---

## 8. OBSERVABILITY MATURITY SCORE

| Dimension | Weight | Score | Weighted |
|---|---|---|---|
| **Correlation ID coverage** | 20% | 2/10 | 0.4 |
| **Structured logging format** | 15% | 3/10 | 0.45 |
| **State transition logging** | 15% | 3/10 | 0.45 |
| **Error classification** | 15% | 2/10 | 0.3 |
| **External API response logging** | 15% | 2/10 | 0.3 |
| **Retry logging** | 10% | 5/10 | 0.5 |
| **Log aggregation & infrastructure** | 10% | 4/10 | 0.4 |

### **Overall Observability Maturity: 2.8 / 10**

### Maturity Level: **Ad-Hoc (Level 1 of 5)**

The system is in the lowest maturity tier. Logging infrastructure (Winston, AsyncLocalStorage, rotation) was built correctly, then the application code was written without using it. The result is a well-architected logging framework that is largely decorative.

---

## 9. SUPPLEMENTARY DATA

### Correlation ID Coverage by File

| File | Logger Type | CorrelationId Auto-Attached? | Total Log Calls |
|---|---|---|---|
| correlationContext.js | correlation logger | ✅ | N/A |
| whatsapp.js | correlation logger | ✅ | 4 |
| transactionManager.js | correlation logger | ✅ | 11 |
| messageProcessor.js | correlation logger | ✅ | 16 |
| authenticate.js | raw Winston | ❌ | 5 |
| errorHandler.js | raw Winston | ❌ | 2 |
| server.js | raw Winston | ❌ | 15+ |
| chatbot.js | raw Winston | ❌ | **207** |
| metaCloud.js | raw Winston | ❌ | **50+** |
| payment.js | raw Winston | ❌ | **44** |
| webhook.js | raw Winston | ❌ | **39** |
| orderStateMachine.js | raw Winston | ❌ | 3 |
| pushNotification.js | raw Winston | ❌ | **28** |
| razorpay.js | raw Winston | ❌ | 16 |
| orderScheduler.js | raw Winston | ❌ | 8 |
| googleSheets.js | **console.log/error** | ❌ | **124** |

### Log Rotation & Retention

| Transport | Condition | File Pattern | Retention | Max Size |
|---|---|---|---|---|
| Console | Always | — | — | — |
| DailyRotateFile (error) | Production only | `logs/error-%DATE%.log` | 14 days | 20MB |
| DailyRotateFile (combined) | Production only | `logs/combined-%DATE%.log` | 7 days | 20MB |
| DailyRotateFile (info) | Production only | `logs/info-%DATE%.log` | 3 days | 20MB |

### Unused Logger Utilities (exported by logger.js but never called)

- `createChildLogger` — 0 callers
- `withCorrelation` — 0 callers
- `logDomainAction` — 0 callers
- `logApiCall` — 0 callers
- `logPerformance` — 0 callers
- `logEvent` — 0 callers
- `logError` — 0 callers
- `startTimer` — 0 callers

---

## 10. PRIORITY FIXES

| # | Fix | Effort | Impact |
|---|---|---|---|
| 1 | **Replace all `require('./logger')` with `require('./correlationContext').logger`** across chatbot.js, payment.js, webhook.js, orderStateMachine.js, razorpay.js, pushNotification.js, metaCloud.js, errorHandler.js, authenticate.js, orderScheduler.js | Low | Instantly gives correlationId to 400+ log calls |
| 2 | **Replace all `console.log/error` in googleSheets.js with `logger.info/error`** | Low | Brings 124 log calls into the Winston pipeline |
| 3 | **Add `orderId` to correlation context at order creation** — `setMetadata('orderId', orderId)` at the start of every checkout function | Trivial | Enables order-level tracing across all downstream calls |
| 4 | **Log payment status transitions** — add `logger.info('Payment status changed', { orderId, from: old, to: new })` before every `paymentStatus` assignment | Low | Fills the biggest audit gap |
| 5 | **Enable `err.stack` in production** — remove the `NODE_ENV === 'development'` gate in errorHandler.js | Trivial | Restores root-cause analysis in production |
| 6 | **Add `logApiCall(service, method, url, status, duration)` wrapper** to Razorpay, Meta, Google calls — the function already exists in logger.js, just needs to be used | Medium | Enables latency monitoring and SLO tracking |
| 7 | **Convert template literals to structured objects** — `logger.info(\`Order ${id}\`)` → `logger.info('Order created', { orderId: id })` | Medium (207 calls in chatbot.js alone) | Makes logs queryable |

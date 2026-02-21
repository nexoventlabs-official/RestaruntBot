# Fault-Tolerance & Crash Recovery Analysis

**Role:** Fault-Tolerance Engineer  
**Method:** Step-by-step side-effect trace of every critical path, injecting crash at each interstitial point  
**Scope:** 5 crash scenarios across 6 code paths (verify-upi, razorpay-webhook, callback, COD checkout, UPI checkout, pickup checkout)

---

## SCENARIO 1: Server Crash After Payment Success, Before DB Write

**Path:** `/verify-upi` — Razorpay confirms payment, HMAC verified, but process dies before `order.save()`.

### Timeline

```
T=0ms   Razorpay payment captured
T=5ms   Client calls /verify-upi with signature
T=10ms  HMAC verified ✓
T=15ms  order = Order.findOne({ orderId }) → paymentStatus='pending'
T=20ms  razorpayService.getPaymentDetails() → amount matches ✓
T=25ms  order.paymentStatus = 'paid' (in-memory only)
T=30ms  ██ CRASH ██  ← before order.save()
```

### Impact

| Question | Answer |
|---|---|
| Does system recover safely? | **PARTIAL** — The Razorpay webhook (`payment.captured`) fires independently and will mark the order as paid via `/razorpay-webhook`. This acts as a backup. |
| Can duplicate order occur? | **No** — The order already exists in DB with `pending` status. No new order is created. |
| Can order be lost? | **No** — Order exists in DB. Webhook backup covers the payment update. |
| Notification sent? | **No** — Customer gets no confirmation from this path. The webhook path does NOT send WhatsApp to the customer (only push to admins). So the customer is silently left without confirmation unless `/callback` also fires. |
| Customer stats updated? | **No** — `totalOrders`/`totalSpent` increment happens after `order.save()`. The webhook path also does NOT update customer stats. **Permanent drift.** |

### Recovery gap
The webhook backup saves the payment status, but **WhatsApp confirmation and customer stats are only in the `/verify-upi` and `/callback` paths**. If both crash, the customer is never notified and their stats are never incremented. No reconciliation job exists.

---

## SCENARIO 2: Crash After DB Write, Before WhatsApp Confirmation

**Paths affected:** All 6 — verify-upi, callback, COD, UPI, pickup

### Timeline (COD example — `processCODOrder`)

```
T=0ms    Customer.findOne() → cart has 3 items
T=50ms   new Order({status:'confirmed', paymentMethod:'cod'})
T=100ms  await order.save()                    ← DB WRITE #1 ✓
T=105ms  DashboardStats.findOneAndUpdate()     ← DB WRITE #2 ✓
T=110ms  sendAdminNewOrderNotification()       ← PUSH ✓
T=150ms  freshCustomer.cart = []; await freshCustomer.save()  ← DB WRITE #3 ✓
T=155ms  ██ CRASH ██  ← before WhatsApp sendMessage
```

### Impact

| Question | Answer |
|---|---|
| Does system recover safely? | **NO** — Order is created and confirmed in DB. Cart is cleared. Admin was notified. But customer never receives WhatsApp confirmation with their order ID. |
| Can duplicate order occur? | **No** — Cart was already cleared at T=150ms. |
| Can order be lost? | **No** — Order is persisted. |
| Customer impact? | **HIGH** — Customer has no order ID, no confirmation, no way to track. They may message again asking "did my order go through?" |

### Variant: Crash between `order.save()` and `customer.save()` (cart clear)

```
T=100ms  await order.save()       ← ✓ order created
T=105ms  ██ CRASH ██              ← before cart is cleared
```

| Question | Answer |
|---|---|
| Does system recover safely? | **NO** |
| Can duplicate order occur? | **YES** — Cart still has items. On next customer message, the chatbot may re-trigger checkout. No dedup guard exists. |
| Can order be lost? | **No** — First order persisted. But a second identical order may also be created. |

### Recovery gap

**No dead-letter queue consumer.** Failed WhatsApp messages are recorded in `OutboundMessage` with `status: 'failed'`, `isRetryable: true`, and a computed `nextRetryAt` — but **no worker ever reads these records and retries them.** The retry infrastructure is built but has no consumer.

**No "paid-but-unnotified" reconciliation cron.** There is no startup or scheduled job that queries:
```js
Order.find({ paymentStatus: 'paid', whatsappConfirmed: { $ne: true } })
```
Such a field doesn't even exist on the schema.

---

## SCENARIO 3: Crash During Webhook Processing

**Path:** `/razorpay-webhook` → `payment.captured` event

### Timeline

```
T=0ms    Razorpay POSTs webhook with event payment.captured
T=5ms    HMAC signature verified ✓
T=10ms   PaymentEvent.create({ eventId: 'evt_abc' })  ← DB WRITE #1 (dedup record) ✓
T=15ms   ██ CRASH ██  ← before Order.findOne and order.save()
```

### Impact — **CRITICAL BUG: Dedup-before-commit**

| Question | Answer |
|---|---|
| Does system recover safely? | **NO — PERMANENT FAILURE** |
| Can duplicate order occur? | No |
| Can order be lost? | **YES — payment captured but order never marked paid** |

**Root cause:** The `PaymentEvent` dedup record is inserted at step 4 (line ~L240) **before** the order update at step 9 (line ~L324). When Razorpay retries the webhook (they retry for up to 24 hours), the dedup check at step 4 returns `{ duplicate: true }` and the request exits immediately. The order is **never updated to `paid`**.

```
Retry #1 (T+5min):   PaymentEvent.create('evt_abc') → E11000 → "duplicate, skipping" → return
Retry #2 (T+15min):  PaymentEvent.create('evt_abc') → E11000 → "duplicate, skipping" → return
...all retries rejected...
Result: Order stays pending forever, auto-cancelled after 15 minutes by orderScheduler
         Customer's money is captured by Razorpay but order is cancelled
```

**This is the single most critical fault-tolerance bug in the system.** The fix is to move `PaymentEvent.create()` to **after** `order.save()` succeeds, or use a two-phase approach (create with `status: 'processing'`, update to `status: 'completed'` after commit, and only reject retries if status is `completed`).

### Variant: Crash after `order.save()` but before response

```
T=10ms   PaymentEvent.create()  ← ✓
T=30ms   order.paymentStatus = 'paid'; await order.save()  ← ✓
T=35ms   ██ CRASH ██  ← before push notification and res.json
```

| Impact | Answer |
|---|---|
| Recovery | **SAFE** — Order is paid in DB. Admin doesn't get push notification. Razorpay considers webhook failed and retries → dedup catches it → returns `ok`. |
| Customer notifications | **NOT SENT** — Webhook path does NOT send WhatsApp to customer. Relies on `/verify-upi` or `/callback`. |
| Admin visibility | Dashboard SSE events not emitted (admin sees it on next refresh). Push not sent. |

---

## SCENARIO 4: Redis Failure During Checkout

### Architecture

Redis is used for **two purposes only**:
1. **Rate limiting** (`rateLimiterRedis.js`) — with in-memory fallback
2. **Metrics** (`metricsRedis.js`) — read/write counters, error recording

Redis is **NOT** used for:
- Session storage
- Idempotency (in-memory `Map`)
- Cart state (MongoDB)
- Order locking
- Checkout state machine

### Timeline

```
T=0ms    Redis connection drops (network partition)
T=5ms    Customer sends "Confirm COD" via WhatsApp
T=10ms   Webhook hits /webhook POST
T=15ms   rateLimiterRedis → fails → insurance (in-memory) limiter activates → request passes
T=20ms   processCODOrder runs normally against MongoDB
T=50ms   order.save() → MongoDB (unaffected) ✓
T=60ms   DashboardStats.findOneAndUpdate() → MongoDB ✓
T=70ms   metricsRedis.recordRequest() → fails → error swallowed in catch
T=80ms   customer.save() → MongoDB ✓
T=90ms   WhatsApp sendMessage() → Meta API (unaffected) ✓
```

### Impact

| Question | Answer |
|---|---|
| Does system recover safely? | **YES** |
| Can duplicate order occur? | **No** — checkout doesn't touch Redis |
| Can order be lost? | **No** — checkout only uses MongoDB |
| Side effects? | Rate limiting degrades to in-memory (per-instance, not distributed). Metrics counters are lost for the duration. No user-facing impact. |

**Redis failure is the one crash scenario this system handles well.** The connection has `enableOfflineQueue: true` and an infinite retry strategy with exponential backoff up to 2s. Redis errors never crash the process (`.on('error')` just logs).

---

## SCENARIO 5: DB Connection Drop Mid-Order

### Timeline (UPI checkout — `processCheckout`)

```
T=0ms    Customer.findOne() → cart loaded ✓ (connection was alive)
T=50ms   Build order object in memory
T=80ms   ██ MongoDB connection drops ██
T=100ms  await order.save() → MongoNetworkError / MongoTimeoutError thrown
T=101ms  Error bubbles up through chatbot.handleMessage catch
T=102ms  Error handler sends WhatsApp: "Something went wrong, please try again"
```

### Impact

| Question | Answer |
|---|---|
| Does system recover safely? | **YES** — The `order.save()` throws before commit. No partial write. Cart is intact. |
| Can duplicate order occur? | **No** — Nothing was written. Customer can retry cleanly. |
| Can order be lost? | **No** — Order was never created. Cart is intact for retry. |

### Variant: Connection drops AFTER `order.save()` but DURING `customer.save()` (cart clear)

```
T=100ms  await order.save()             ← ✓ committed to MongoDB
T=120ms  ██ MongoDB connection drops ██
T=130ms  await freshCustomer.save()     ← MongoNetworkError thrown
T=131ms  Error handler sends WhatsApp: "Something went wrong"
```

| Question | Answer |
|---|---|
| Does system recover safely? | **NO** |
| Can duplicate order occur? | **YES** — Order is created but cart not cleared. On retry, customer re-checksout with the same cart. |
| Can order be lost? | **No** — First order is persisted. |
| Customer stats? | Not updated. DashboardStats not incremented. Google Sheets not updated. |

### MongoDB reconnection behavior

From `server.js`: MongoDB connection uses `serverSelectionTimeoutMS: 5000`. The Mongoose driver automatically reconnects. The `connectMongoDB()` function has `setTimeout(connectMongoDB, 5000)` for initial connection failures. However, there is **no hook** that runs after reconnection to reconcile partially-completed operations.

---

## SIDE-EFFECT TRACES — ALL CRITICAL PATHS

### PAYMENT VERIFY-UPI PATH (`payment.js` `/verify-upi`)

| Step | Line(s) | Side-Effect | Type |
|------|---------|-------------|------|
| 1 | L69 | Receive `orderId`, `razorpay_payment_id`, `razorpay_order_id`, `razorpay_signature` | Input |
| 2 | L72-L78 | Verify HMAC signature (CPU only, no side-effect) | Validation |
| 3 | L81 | **DB READ**: `Order.findOne({ orderId })` | DB Read |
| 4 | L87-L89 | Idempotency guard: if `paymentStatus === 'paid'`, return early | Guard |
| 5 | L93-L101 | **EXTERNAL API**: `razorpayService.getPaymentDetails(razorpay_payment_id)` — amount verification | External API |
| 6 | L104-L107 | Mutate in-memory order: `paymentStatus = 'paid'`, `paymentId`, `razorpayPaymentId` | In-memory |
| 7 | L108-L111 | `transitionStatus(order, 'confirmed', ...)` — mutates order status in-memory | In-memory |
| 8 | L112 | **DB WRITE #1**: `await order.save()` — order marked paid + confirmed | DB Write |
| 9 | L115-L116 | **SSE EVENT**: `dataEvents.emit('orders')`, `dataEvents.emit('dashboard')` | Event |
| 10 | L119-L121 | **GOOGLE SHEETS** (fire-and-forget): `googleSheets.updateOrderStatus(...)` | External API |
| 11 | L123-L143 | Build confirmation message string (no side-effect) | In-memory |
| 12 | L145 | **DB READ**: `chatbotImagesService.getImageUrl('payment_success')` | DB Read |
| 13 | L148-L156 | **WHATSAPP SEND** (awaited, in try/catch): `whatsapp.sendImageWithButtons(...)` | External API |
| 14 | L157-L159 | On WhatsApp failure: error logged, **silently swallowed** | Error handling |
| 15 | L162-L167 | **EMAIL** (awaited, in try/catch): `brevoMail.sendOrderConfirmation(...)` | External API |
| 16 | L170-L174 | **DB READ + WRITE #2**: `Customer.findOne(...)`, increment `totalOrders`, `totalSpent`, `customer.save()` | DB Write |
| 17 | L177-L196 | **PUSH NOTIFICATION** (awaited, in try/catch): Find admins with push tokens, send push. On failure: swallowed | External API + DB Read |
| 18 | L199 | **HTTP RESPONSE**: `res.json({ success: true })` | Response |

### RAZORPAY WEBHOOK PATH (`payment.js` `/razorpay-webhook`)

| Step | Line(s) | Side-Effect | Type |
|------|---------|-------------|------|
| 1 | L206-L215 | Verify `RAZORPAY_WEBHOOK_SECRET` exists | Validation |
| 2 | L217-L229 | Verify webhook signature with `crypto.timingSafeEqual` | Validation |
| 3 | L231-L232 | Parse JSON body | Parse |
| 4 | L235-L243 | **DB WRITE #1**: `PaymentEvent.create({ eventId })` — idempotency dedup. On duplicate: return `{ ok, duplicate }` | DB Write |
| 5 | L316-L317 | Extract `paymentLinkId` from payment notes | In-memory |
| 6 | L319 | **DB READ**: `Order.findOne({ razorpayOrderId: paymentLinkId })` | DB Read |
| 7 | L320 | Idempotency guard: `order.paymentStatus !== 'paid'` | Guard |
| 8 | L321-L323 | Mutate order: `paymentStatus = 'paid'`, `razorpayPaymentId`, `transitionStatus(order, 'confirmed')` | In-memory |
| 9 | L324 | **DB WRITE #2**: `await order.save()` | DB Write |
| 10 | L327-L329 | **SSE EVENT**: emit `orders`, `dashboard` | Event |
| 11 | L332-L334 | **GOOGLE SHEETS** (fire-and-forget) | External API |
| 12 | L337-L351 | **PUSH NOTIFICATION** (awaited, try/catch): Find admins, push. Swallowed on failure | External API |
| 13 | L354 | Return `{ status: 'ok' }` | Response |

**Notable**: The webhook path does **NOT** send WhatsApp confirmation to customer, does **NOT** send email, does **NOT** update customer stats.

### CALLBACK PATH (`payment.js` `/callback`)

| Step | Line(s) | Side-Effect | Type |
|------|---------|-------------|------|
| 1 | L358-L374 | Signature verification (optional—proceeds with warning if missing) | Validation |
| 2 | L376 | Check `razorpay_payment_link_status === 'paid'` | Guard |
| 3 | L377 | **DB READ**: `Order.findOne({ razorpayOrderId })` | DB Read |
| 4 | L378 | Idempotency guard: `order.paymentStatus !== 'paid'` | Guard |
| 5 | L379-L383 | Mutate order | In-memory |
| 6 | L384 | **DB WRITE #1**: `await order.save()` | DB Write |
| 7 | L387-L389 | **SSE EVENT** | Event |
| 8 | L392-L394 | **GOOGLE SHEETS** (fire-and-forget) | External API |
| 9 | L430-L441 | **WHATSAPP SEND** (awaited, **NOT in try/catch**) | External API |
| 10 | L444-L449 | **EMAIL** (awaited, in try/catch) | External API |
| 11 | L452-L456 | **DB WRITE #2**: Customer stats update | DB Write |
| 12 | L459-L476 | **PUSH NOTIFICATION** (awaited, try/catch) | External API |
| 13 | L481-L495 | **HTTP RESPONSE**: Render HTML success page | Response |

**CRITICAL BUG**: Step 9 WhatsApp send is **NOT** wrapped in try/catch. If WhatsApp fails, the entire callback errors out even though the order is already saved as `paid`.

### COD ORDER CREATION PATH (`chatbot.js` `processCODOrder`)

| Step | Line(s) | Side-Effect | Type |
|------|---------|-------------|------|
| 1 | L7857 | **DB READ**: `Customer.findOne({ phone }).populate('cart.menuItem')` | DB Read |
| 2 | L7859-L7862 | Empty cart check | Guard |
| 3 | L7864-L7952 | Build items array with pricing (no side-effect) | In-memory |
| 4 | L7974-L7993 | Create `new Order({status:'confirmed', paymentMethod:'cod'})` | In-memory |
| 5 | L7994 | **DB WRITE #1**: `await order.save()` | DB Write |
| 6 | L8003-L8004 | **DB WRITE #2**: `whatsappBroadcast.addContact(...)` | DB Write |
| 7 | L8012-L8023 | **DB WRITE #3**: `DashboardStats.findOneAndUpdate(...)` (try/catch, swallowed) | DB Write |
| 8 | L8026-L8028 | **SSE EVENT**: emit `orders`, `dashboard` | Event |
| 9 | L8031 | **GOOGLE SHEETS** (fire-and-forget): `googleSheets.addOrder(order)` | External API |
| 10 | L8034 | **GOOGLE SHEETS** (fire-and-forget): `googleSheets.syncTodayDailyReport()` | External API |
| 11 | L8037-L8052 | **PUSH NOTIFICATION** (awaited, try/catch): Admin push. Swallowed on failure | External API |
| 12 | L8055-L8058 | **DB WRITE #4**: Clear cart, push orderHistory, `await freshCustomer.save()` | DB Write |
| 13 | L8086-L8090 | **WHATSAPP SEND** (awaited, **NOT in try/catch**): Customer confirmation | External API |
| 14 | L8092 | Return `{ success: true }` | Response |

### UPI CHECKOUT PATH (`chatbot.js` `processCheckout`)

| Step | Line(s) | Side-Effect | Type |
|------|---------|-------------|------|
| 1 | L8388 | **DB READ**: `Customer.findOne({ phone }).populate('cart.menuItem')` | DB Read |
| 2 | L8390-L8394 | Empty cart check | Guard |
| 3 | L8508-L8527 | Create `new Order({status:'pending'})` | In-memory |
| 4 | L8528 | **DB WRITE #1**: `await order.save()` | DB Write |
| 5 | L8531-L8535 | **DB WRITE #2**: Remove offers + `await freshCustomer.save()` | DB Write |
| 6 | L8538-L8539 | **DB WRITE #3**: `whatsappBroadcast.addContact(...)` | DB Write |
| 7 | L8546-L8553 | **DB WRITE #4**: `DashboardStats.findOneAndUpdate(...)` (try/catch) | DB Write |
| 8 | L8557-L8559 | **SSE EVENT** | Event |
| 9 | L8562-L8565 | **GOOGLE SHEETS** (fire-and-forget) | External API |
| 10 | L8590-L8594 | **DB WRITE #5**: Clear cart, push orderHistory, `await freshCustomer.save()` | DB Write |
| 11 | L8603-L8656 | **WHATSAPP SEND**: Payment link to customer | External API |
| 12 | | Return `{ success: true }` | Response |

### PICKUP CHECKOUT PATH (`chatbot.js` `processPickupCheckout`)

| Step | Line(s) | Side-Effect | Type |
|------|---------|-------------|------|
| 1 | L9258 | **DB READ**: `Customer.findOne({ phone }).populate('cart.menuItem')` | DB Read |
| 2 | L9351-L9365 | Create `new Order({serviceType:'pickup', status:'pending'})` | In-memory |
| 3 | L9367 | **DB WRITE #1**: `await order.save()` | DB Write |
| 4 | L9377-L9380 | **DB WRITE #2**: Clear cart + `await freshCustomer.save()` | DB Write |
| 5 | L9421-L9422 | **WHATSAPP SEND**: Customer confirmation | External API |
| 6 | L9425-L9427 | **SSE EVENT** | Event |
| 7 | L9430-L9434 | **GOOGLE SHEETS** (fire-and-forget) | External API |
| 8 | L9437-L9452 | **PUSH NOTIFICATION** (awaited, try/catch) | External API |
| 9 | L9455-L9457 | **DB WRITE #3**: `orderHistory.push()`, `await freshCustomer.save()` | DB Write |
| 10 | L9459 | Return `{ success: true, orderId }` | Response |

---

## INFRASTRUCTURE & RECOVERY MECHANISMS

### What exists

| Mechanism | Scope | Works? |
|---|---|---|
| `orderScheduler` — auto-cancel pending/unpaid after 15min | Unpaid UPI orders | **YES** ✓ but can cancel orders where payment was captured but webhook dedup bug prevented DB update |
| `refundScheduler` — recover scheduled refunds on startup | Refund processing | **YES** ✓ — scans DB for `refundStatus: 'scheduled'`, runs on startup and every 2min |
| `rateLimiter` in-memory fallback | Redis failure | **YES** ✓ |
| `PaymentEvent` webhook dedup | Duplicate Razorpay webhooks | **BROKEN** — dedup record written before commit; crash causes permanent event loss |
| `InboundMessage` message dedup | Duplicate WhatsApp messages | **YES** ✓ — MongoDB unique index, atomic |
| Google Sheets `addOrderToSheet` dedup | Duplicate sheet rows | **YES** ✓ — checks if orderId exists before insert |
| Graceful shutdown (`server.close()`) | Clean stop | **PARTIAL** — stops new connections but `isShuttingDown` flag is never checked by handlers |

### What is missing

| Missing Mechanism | Impact | Priority |
|---|---|---|
| **"Paid-but-unnotified" reconciliation cron** | Customer pays, crash kills notification. Customer never learns their order was placed. | **CRITICAL** |
| **Dedup-after-commit for webhooks** | Crash between dedup insert and order update = permanent payment loss. Auto-cancel then deletes the order. Money captured but order gone. | **CRITICAL** |
| **Outbound message retry worker** | `OutboundMessage` records with `isRetryable: true` and `nextRetryAt` are never consumed. Dead infrastructure. | **HIGH** |
| **Atomic order+cart clear** | All 3 checkout paths have a gap between `order.save()` and `customer.save()`. Crash here = duplicate order on retry. | **HIGH** |
| **Transaction usage in checkout** | `transactionManager.execute()` exists but NO checkout path uses it for the order+cart atomic write. | **HIGH** |
| **Startup reconciliation job** | No scan for orphaned states: orders with `status: confirmed` but no WhatsApp record, carts that should have been cleared, stats drift. | **MEDIUM** |
| **Graceful drain of in-flight requests** | `isShuttingDown` flag is set but never checked. A SIGTERM during a checkout can split the multi-step flow. | **MEDIUM** |
| **Persistent saga log** | `executeWithCompensation()` tracks state in memory. Process crash = partial compensation, no recovery. | **LOW** |
| **Dashboard stats reconciliation** | `sync-dashboard-stats.js` exists but is manual-only CLI. No scheduled run. Counter drift is permanent without manual intervention. | **LOW** |

### WhatsApp Service — No Retry Consumer

- `OutboundMessage` records are created with `status: 'failed'`, `isRetryable: true`, and `nextRetryAt` (exponential backoff)
- **But no worker reads these records and retries them** — the infrastructure is built with no consumer
- No dead-letter queue
- No circuit breaker in the main send path (imported but unused)
- Errors are re-thrown to caller — some callers catch (verify-upi), some don't (callback)

### Push Notification Service

- `MAX_RETRIES = 2` (3 total attempts), exponential backoff (500ms, 1s)
- Returns `false` on failure — **does NOT throw**
- Stale tokens tracked in-memory (24h) but never cleaned from DB
- Badge counts in-memory, not shared across instances

### Graceful Shutdown

- `SIGTERM` / `SIGINT`: Sets `isShuttingDown = true` → `server.close()` → disconnect SSE → stop schedulers → close MongoDB → close Redis → force exit after 15s
- **`isShuttingDown` flag is never checked by route handlers** — in-flight requests continue against closing connections
- In-flight DB writes race against `mongoose.disconnect()`

### Transaction Manager — Unused in Critical Paths

- `transactionManager.execute()`: Session-based, snapshot isolation, majority write concern, retry on transient errors, session cleanup in `finally`
- `executeWithOptimisticLock()`: CAS pattern with `__v` — **never used**
- `executeWithCompensation()`: Saga pattern — **never used, in-memory only, no persistent log**
- **None of the 6 critical paths above use any of these** — all order creation is plain `save()`

---

## CRASH MATRIX — COMPLETE VIEW

| Scenario | Recover? | Dup Order? | Order Lost? | Customer Notified? | Stats Correct? |
|---|---|---|---|---|---|
| **1. Crash after payment, before DB write** | Partial (webhook backup) | No | No | **NO** — webhook doesn't WhatsApp customer | **NO** — stats not updated |
| **2a. Crash after DB write, before WhatsApp** | No recovery | No (if cart cleared) | No | **NO** | Yes (if stats step passed) |
| **2b. Crash after order.save, before cart clear** | No recovery | **YES** | No | **NO** | **NO** |
| **3a. Webhook crash after dedup, before order update** | **NO — PERMANENT** | No | **YES** — order stays pending, auto-cancelled, money captured | N/A | N/A |
| **3b. Webhook crash after order update** | Safe | No | No | N/A (webhook doesn't notify) | Push missed |
| **4. Redis failure during checkout** | **SAFE** | No | No | Yes | Yes (except metrics) |
| **5a. DB drop before order.save** | **SAFE** — clean retry | No | No | Error msg sent | N/A |
| **5b. DB drop after order.save, before cart clear** | No recovery | **YES** | No | **NO** | **NO** |

---

## TOP 5 FIXES BY IMPACT

| # | Fix | Effort | What it solves |
|---|---|---|---|
| 1 | **Move `PaymentEvent.create()` to AFTER `order.save()`** — or use two-phase: insert with `status:'processing'`, update to `'completed'` after commit, only reject retries where status is `'completed'` | Low | Eliminates permanent payment loss on webhook crash (Scenario 3a) |
| 2 | **Add reconciliation cron** — every 5min query `Order.find({ paymentStatus:'paid', status:'confirmed', createdAt: { $lt: 5min_ago } })` and cross-check against `OutboundMessage` for confirmation delivery. Re-send if missing. | Medium | Covers Scenarios 1, 2a, 2b, 5b for customer notification |
| 3 | **Wrap order+cart in a transaction** — Use `transactionManager.execute()` for `order.save()` + `customer.save()` (cart clear) atomically. Re-read customer inside session. | Medium | Eliminates duplicate orders on crash between order and cart clear (Scenarios 2b, 5b) |
| 4 | **Build outbound message retry worker** — Cron that queries `OutboundMessage.find({ status:'failed', isRetryable:true, nextRetryAt: { $lte: now } })` and retries with exponential backoff | Medium | Activates the existing dead-letter infrastructure for WhatsApp failures |
| 5 | **Check `isShuttingDown` in webhook/payment routes** — Return 503 so Razorpay/Meta retry on a healthy instance. Drain in-flight requests with a countdown. | Low | Prevents split operations during graceful shutdown |

---

**Overall Fault-Tolerance Grade: D+**

The system has **one correct recovery mechanism** (refund scheduler) and **one correctly degrading dependency** (Redis). Everything else — payment webhook dedup, notification delivery, cart atomicity, stats consistency — has unrecoverable gaps. The most dangerous bug is the **dedup-before-commit pattern** in the webhook handler, which can cause permanent payment capture without order fulfillment.

# Order Lifecycle Trace — Full Analysis

**Date**: February 20, 2026  
**Role**: Distributed Systems Engineer  
**Scope**: Order model, state machine, 21 status-mutation paths across routes/services/domains

---

## Table of Contents

1. [All Possible Order States](#1-all-possible-order-states)
2. [Where States Are Stored](#2-where-states-are-stored)
3. [State Transition Validation — Gated vs Ungated](#3-state-transition-validation--gated-vs-ungated)
4. [Transition Matrix](#4-transition-matrix)
5. [Illegal Transition Possibilities](#5-illegal-transition-possibilities)
6. [Atomicity Analysis](#6-atomicity-analysis)
7. [Crash Recovery Analysis](#7-crash-recovery-analysis)
8. [Launch Safety Verdict](#8-launch-safety-verdict)

---

## 1. All Possible Order States

### `order.status` — 9 values

| State | Terminal? | How It's Created |
|---|---|---|
| `pending` | No | Schema default; created by `processCheckout()`, `processPickupCheckout()` |
| `confirmed` | No | Set on payment verification, or directly by `processCODOrder()` |
| `preparing` | No | Set by admin via `PUT /orders/:id/status` |
| `ready` | No | Set by admin |
| `out_for_delivery` | No | Set by admin |
| `delivered` | Semi-terminal | Set by admin, delivery boy route, or auto-check-payment |
| `cancelled` | Semi-terminal | Set by chatbot, orderScheduler (auto-expire), admin, domain handler |
| `refunded` | **Terminal** | Set by refundScheduler, payment webhook, admin approval |
| `refund_failed` | Semi-terminal | Set by refundScheduler or admin on Razorpay failure |

### `order.paymentStatus` — 7 values

| Value | Description |
|---|---|
| `pending` | Awaiting payment |
| `paid` | Payment confirmed |
| `failed` | Payment attempt failed |
| `cancelled` | Payment cancelled (COD orders) |
| `refund_processing` | Refund in progress |
| `refunded` | Refund completed |
| `refund_failed` | Refund attempt failed |

**Typical flows:**
```
pending → paid → refund_processing → refunded
pending → failed
pending → cancelled
paid → refund_failed
```

### `order.refundStatus` — 7 values

| Value | Description |
|---|---|
| `none` | No refund requested |
| `pending` | Refund requested |
| `scheduled` | Refund scheduled for processing |
| `approved` | Refund approved by admin |
| `completed` | Refund processed by Razorpay |
| `rejected` | Refund rejected by admin |
| `failed` | Razorpay refund failed |

---

## 2. Where States Are Stored

| Layer | Storage | Persistence | Consistency |
|---|---|---|---|
| **Primary source of truth** | MongoDB `orders` collection, `status` field | Durable | Strong (single-document) |
| **Payment state** | Same document: `paymentStatus`, `refundStatus` | Durable | Strong |
| **Audit trail** | `order.trackingUpdates[]` (embedded array) | Durable | Strong |
| **Google Sheets mirror** | Separate sheet per status | Eventually consistent | Fire-and-forget `.catch()` |
| **Real-time broadcast** | SSE via `dataEvents.emit('orders')` | Ephemeral, in-memory | Best-effort |
| **Dashboard stats cache** | `DashboardStats` collection | Separate document | Eventually consistent |

**Key observation**: There is no Redis-backed state, no event sourcing, no WAL. State is a single mutable field on the MongoDB document.

---

## 3. State Transition Validation — Gated vs Ungated

### The State Machine (`backend/services/orderStateMachine.js`)

```js
ALLOWED_TRANSITIONS = {
  pending:          → [confirmed, cancelled]
  confirmed:        → [preparing, ready, cancelled, refunded, refund_failed]
  preparing:        → [ready, cancelled, refunded, refund_failed]
  ready:            → [out_for_delivery, delivered, cancelled, refunded, refund_failed]
  out_for_delivery: → [delivered, cancelled, refunded, refund_failed]
  delivered:        → [refunded, refund_failed]
  cancelled:        → [refunded, refund_failed]
  refunded:         → []                          ← TERMINAL
  refund_failed:    → [refunded, cancelled]
}
```

The state machine provides two functions:
- `validateTransition(from, to)` → returns `{ valid, reason }`
- `transitionStatus(order, newStatus, trackingMessage)` → validates, mutates, pushes tracking update

### Who Uses It vs. Who Bypasses It

| # | Code Path | File | Uses State Machine? | How It Mutates |
|---|---|---|---|---|
| 1 | Admin status update | `routes/order.js` L203 | ✅ `validateTransition()` | `order.status = status` after validation |
| 2 | Payment verify-upi | `routes/payment.js` L109 | ✅ `transitionStatus()` | Via state machine |
| 3 | Razorpay webhook refund.processed | `routes/payment.js` L293 | ✅ `transitionStatus()` | Via state machine |
| 4 | Razorpay webhook refund.failed | `routes/payment.js` L354 | ✅ `transitionStatus()` | Via state machine |
| 5 | Razorpay webhook payment.captured | `routes/payment.js` L397 | ✅ `transitionStatus()` | Via state machine |
| 6 | Payment callback | `routes/payment.js` L473 | ✅ `transitionStatus()` | Via state machine |
| 7 | Payment refund (route) | `routes/payment.js` L608 | ✅ `transitionStatus()` | Via state machine |
| 8 | Payment refund fail (route) | `routes/payment.js` L642 | ✅ `transitionStatus()` | Via state machine |
| 9 | WhatsApp payment webhook | `routes/webhook.js` L253 | ✅ `transitionStatus()` | Via state machine |
| 10 | Chatbot COD order creation | `services/chatbot.js` ~L7967 | ❌ **BYPASSED** | `status: 'confirmed'` in constructor |
| 11 | Chatbot online order creation | `services/chatbot.js` ~L8500 | ❌ **BYPASSED** | `status: 'pending'` in constructor |
| 12 | Chatbot pickup order creation | `services/chatbot.js` ~L9349 | ❌ **BYPASSED** | `status: 'pending'` in constructor |
| 13 | Chatbot cancel order | `services/chatbot.js` ~L8900 | ❌ **BYPASSED** | `order.status = 'cancelled'` |
| 14 | Chatbot refund request | `services/chatbot.js` ~L9082 | ❌ **BYPASSED** | `order.status = 'cancelled'` |
| 15 | Domain orderHandler cancel | `services/domains/orderHandler.js` L137 | ❌ **BYPASSED** | `order.status = 'cancelled'` |
| 16 | Domain paymentCompletion success | `services/domains/paymentCompletionHandler.js` L118 | ❌ **BYPASSED** | `order.status = ORDER_STATUS.CONFIRMED` |
| 17 | Domain paymentCompletion refund | `services/domains/paymentCompletionHandler.js` L464 | ❌ **BYPASSED** | `order.status = ORDER_STATUS.REFUNDED` |
| 18 | Domain paymentCompletion webhook | `services/domains/paymentCompletionHandler.js` L590 | ❌ **BYPASSED** | `order.status = ORDER_STATUS.CONFIRMED` |
| 19 | Domain paymentCompletion webhook refund | `services/domains/paymentCompletionHandler.js` L652 | ❌ **BYPASSED** | `order.status = ORDER_STATUS.REFUNDED` |
| 20 | OrderScheduler auto-cancel | `services/orderScheduler.js` L46 | ❌ **BYPASSED** | `order.status = 'cancelled'` |
| 21 | RefundScheduler refund | `services/refundScheduler.js` L115 | ❌ **BYPASSED** | `order.status = 'refunded'` |
| 22 | RefundScheduler fail | `services/refundScheduler.js` L148 | ❌ **BYPASSED** | `order.status = 'refund_failed'` |
| 23 | Admin refund approve | `routes/order.js` L806 | ❌ **BYPASSED** | `order.status = 'refunded'` |
| 24 | Admin refund fail | `routes/order.js` L827 | ❌ **BYPASSED** | `order.status = 'refund_failed'` |
| 25 | Delivery boy deliver | `routes/deliveryboy.js` L1198 | ❌ **BYPASSED** | `status: 'delivered'` via `findOneAndUpdate` |

### Coverage Summary

```
State machine gated:    9 of 25 paths  (36%)
State machine bypassed: 16 of 25 paths (64%)
```

---

## 4. Transition Matrix

### State Machine Definition (what SHOULD be enforced)

```
FROM ╲ TO           │ pen │ con │ pre │ rdy │ ofd │ del │ can │ ref │ r_f │
─────────────────────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
pending              │  ·  │  ✓  │     │     │     │     │  ✓  │     │     │
confirmed            │     │  ·  │  ✓  │  ✓  │     │     │  ✓  │  ✓  │  ✓  │
preparing            │     │     │  ·  │  ✓  │     │     │  ✓  │  ✓  │  ✓  │
ready                │     │     │     │  ·  │  ✓  │  ✓  │  ✓  │  ✓  │  ✓  │
out_for_delivery     │     │     │     │     │  ·  │  ✓  │  ✓  │  ✓  │  ✓  │
delivered            │     │     │     │     │     │  ·  │     │  ✓  │  ✓  │
cancelled            │     │     │     │     │     │     │  ·  │  ✓  │  ✓  │
refunded             │     │     │     │     │     │     │     │  ·  │     │
refund_failed        │     │     │     │     │     │     │  ✓  │  ✓  │  ·  │

✓ = Allowed     (blank) = Blocked     · = Same state (no-op, allowed)
```

### What Actually Happens in Code (including bypass paths)

```
FROM ╲ TO           │ pen │ con │ pre │ rdy │ ofd │ del │ can │ ref │ r_f │
─────────────────────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┼─────┤
pending              │  ·  │ ✅  │     │     │     │     │ ✅  │     │     │
confirmed            │     │  ·  │ ✅  │ ✅  │     │     │ ⚠️  │ ⚠️  │ ⚠️  │
preparing            │     │     │  ·  │ ✅  │     │     │ ⚠️  │     │     │
ready                │     │     │     │  ·  │ ✅  │ ✅  │ ⚠️  │     │     │
out_for_delivery     │     │     │     │     │  ·  │ ✅  │ ⚠️  │     │     │
delivered            │     │     │     │     │     │  ·  │ 🔴  │ ⚠️  │     │
cancelled            │     │ 🔴  │     │     │     │     │  ·  │ ⚠️  │ ⚠️  │
refunded             │     │     │     │     │     │     │     │  ·  │     │
refund_failed        │     │     │     │     │     │     │     │ ⚠️  │  ·  │

✅ = Gated by state machine
⚠️ = Bypasses state machine (direct assignment, but logically valid intent)
🔴 = ILLEGAL transition possible due to bypass + race condition
```

---

## 5. Illegal Transition Possibilities

### 🔴 Scenario A: `cancelled` → `confirmed` (Race Condition)

**Steps to reproduce:**
```
T=0  Customer places online order         → status = 'pending'
T=1  Customer cancels via WhatsApp        → chatbot sets status = 'cancelled' (no state machine)
T=2  Razorpay payment.captured webhook    → transitionStatus(order, 'confirmed')
```

**What happens:**
- If T=2 reads the order BEFORE T=1's `save()` completes, the webhook sees `pending` and transitions to `confirmed` ✅
- The order is now `confirmed` but the customer thinks it's cancelled
- If T=2 reads AFTER T=1, state machine blocks `cancelled → confirmed` ✅
- **Window of vulnerability**: milliseconds, but real under load

**Impact**: Customer charged for a cancelled order. Delivery proceeds on an unwanted order.

---

### 🔴 Scenario B: `delivered` → `cancelled` (Chatbot Refund Path)

**Steps to reproduce:**
```
T=0  Admin marks order as 'delivered'
T=1  Customer sends "refund" via WhatsApp
T=2  chatbot.js L9082: order.status = 'cancelled'   ← NO VALIDATION
T=3  order.save() succeeds
```

**What happens:**
- The chatbot's refund path at L9058-9082 checks `if (order.status === 'delivered')` only to block refund requests
- But the chatbot's generic cancel path at L8880 checks `['delivered', 'cancelled', 'refunded'].includes(order.status)` and blocks correctly
- The refund path at L9082 sets `order.status = 'cancelled'` for orders that are NOT delivered, including states like `preparing`, `ready`, `out_for_delivery`
- For `out_for_delivery`, this means: order is en route, customer requests refund, order jumps to `cancelled` while delivery partner is still carrying the food

**Impact**: Delivery partner arrives with food for a cancelled order. Financial discrepancy on COD.

---

### 🔴 Scenario C: Double Refund (Financial Risk)

**Steps to reproduce:**
```
T=0  Customer requests refund → refundStatus = 'pending', order.status = 'cancelled'
T=1  refundScheduler picks it up → calls Razorpay API → order.status = 'refunded'
T=2  Admin clicks "Approve Refund" → routes/order.js L806 → calls Razorpay API again
T=3  Razorpay webhook refund.processed fires → transitionStatus(order, 'refunded')
```

**What happens:**
- Three independent processors attempt the refund with no distributed lock
- Razorpay API may reject a duplicate refund (depends on idempotency key), but:
  - `refundScheduler` and admin route use different code paths
  - No shared idempotency key across the three paths
  - Admin route doesn't check `refundStatus === 'completed'` before calling Razorpay

**Impact**: Customer refunded twice. Direct financial loss.

---

### 🟡 Scenario D: `preparing` → `cancelled` (Chatbot Bypass)

**Steps to reproduce:**
```
T=0  Admin sets order to 'preparing' (kitchen is cooking)
T=1  Customer sends "cancel order" via WhatsApp
T=2  chatbot.js L8900: order.status = 'cancelled'   ← NO STATE MACHINE
```

**What happens:**
- The chatbot only blocks cancellation for `['delivered', 'cancelled', 'refunded']`
- Orders in `preparing`, `ready`, or `out_for_delivery` CAN be cancelled by the customer
- The state machine ALLOWS `preparing → cancelled`, so this is technically valid
- But the chatbot doesn't USE the state machine to validate — it just has an incomplete manual check

**Impact**: Food waste (already being prepared). Low severity but operationally wasteful.

---

### 🟡 Scenario E: Stale Read on Concurrent Updates

**Steps to reproduce:**
```
T=0  Admin opens order detail page (reads status = 'confirmed')
T=1  Another admin sets status = 'preparing' at the same time
T=2  First admin clicks "Ready" (expects confirmed → preparing → ready)
T=3  order.js: validateTransition('confirmed', 'ready') → VALID (state machine allows skip)
T=4  But actual DB state is 'preparing', not 'confirmed'
```

**What happens:**
- The admin route reads the order, validates in-memory, then saves
- No optimistic concurrency control (`__v` versioning or `{ status: expectedStatus }` filter)
- The save succeeds because MongoDB doesn't reject it — it's a simple `$set`
- Result is valid in this case (`preparing → ready` is allowed), but demonstrates the lack of concurrency control

**Impact**: Low for this specific case, but the pattern enables all race conditions described above.

---

### ✅ Scenario F: Delivery Boy — Properly Guarded

**The delivery boy route is the ONE path that does this correctly:**

```js
// deliveryboy.js L1191
const order = await Order.findOneAndUpdate(
  {
    orderId,
    status: 'out_for_delivery',        // ← Precondition in query filter
    assignedTo: req.deliveryBoy._id     // ← Authorization check
  },
  {
    $set: { status: 'delivered', ... }
  },
  { new: true }
);
```

If the order is NOT in `out_for_delivery`, the query returns `null` and the route returns 404. This is **atomic** — no TOCTOU race possible. This is the pattern ALL status mutations should use.

---

## 6. Atomicity Analysis

### Single-Document Writes: ✅ Atomic

Each `order.save()` is atomic at the MongoDB document level. The document either fully updates or doesn't.

### Multi-Step Side-Effect Chain: ❌ NOT Atomic

Every status transition involves multiple side effects with no transactional binding:

```
Step 1: order.status = 'confirmed'
Step 2: await order.save()                              ← MongoDB write (atomic)
Step 3: dataEvents.emit('orders')                       ← SSE broadcast (ephemeral)
Step 4: googleSheets.updateOrderStatus(...)             ← External API (fire-and-forget)
Step 5: whatsapp.sendButtons(...)                       ← External API (can fail)
Step 6: pushNotification.sendNotification(...)          ← External API (can fail)
Step 7: DashboardStats.findOneAndUpdate(...)            ← Separate MongoDB write
```

If the server crashes between any two steps, the system is left in an inconsistent state.

### Transaction Manager: EXISTS but NOT used for orders

`backend/services/transactionManager.js` provides proper MongoDB session-based transactions with retry logic. However, it is **only used in `cartHandler.js`** for cart operations. Zero order creation or status mutation paths use it.

### Optimistic Locking: NOT implemented

- No `__v` (version key) checks on `save()`
- No `{ status: expectedStatus }` filter on `findOneAndUpdate()` (except delivery boy route)
- Two concurrent writers can both read `status = 'pending'`, both update, and the last write wins

---

## 7. Crash Recovery Analysis

| Crash Point | State After Crash | Recovery Mechanism | Risk |
|---|---|---|---|
| After `new Order()`, before `order.save()` | Order lost; customer may see "order placed" message already sent | ❌ None | 🔴 Ghost order from customer's perspective |
| After `order.save()`, before WhatsApp notification | Order exists in DB, customer never notified | ❌ No retry queue | 🟡 Customer confused, admin sees it |
| After `order.save()`, before Google Sheets sync | MongoDB correct, Sheets stale | ⚠️ `syncTodayDailyReport()` cron may catch up | 🟡 Manual reconciliation needed |
| After `order.save()`, before `DashboardStats` update | Stats counter wrong | ⚠️ `dailyCleanup` eventually repairs | 🟢 Self-healing, delayed |
| After Razorpay refund API call, before `order.save()` | Money refunded in Razorpay but order still shows `cancelled` | ⚠️ Razorpay webhook may reconcile | 🔴 Window of inconsistency |
| During `orderScheduler` auto-cancel, after save, before WhatsApp | Order cancelled, customer still sees "pending" | ❌ No retry | 🟡 Customer times out and re-checks |
| During delivery boy `findOneAndUpdate`, mid-write | MongoDB guarantees atomic single-doc write | ✅ Atomic | 🟢 Safe |

### Missing Recovery Mechanisms

| Pattern | Status |
|---|---|
| Transactional outbox (persist side-effects as events, process later) | ❌ Not implemented |
| Saga / compensating transactions | ❌ Not implemented |
| Scheduled reconciliation job (MongoDB vs Sheets vs Razorpay) | ❌ Not implemented |
| Idempotency keys on status transitions | ⚠️ Only on payment webhooks via `PaymentEvent` model |
| Dead letter queue for failed notifications | ❌ Not implemented |

---

## 8. Launch Safety Verdict

### 🟡 CONDITIONAL PASS — Launch with mitigations

The system will work correctly for the **happy path** (the normal order flow) but has dangerous edge cases around concurrency, bypass logic, and crash recovery.

### Scorecard

| Area | Rating | Details |
|---|---|---|
| **Happy-path order flow** | ✅ Safe | `pending → confirmed → preparing → ready → out_for_delivery → delivered` works correctly |
| **Payment verification** | ✅ Safe | Uses state machine, has idempotency guards, signature verification |
| **Admin status updates** | ✅ Safe | Uses `validateTransition()` before applying |
| **Delivery boy completion** | ✅ Safe | Uses atomic `findOneAndUpdate` with status precondition |
| **Chatbot cancellation** | 🟡 Risky | Bypasses state machine, manual guards are incomplete |
| **Concurrent mutations** | 🔴 Unsafe | No optimistic locking except delivery boy route |
| **Refund flow** | 🔴 Unsafe | Three independent processors, no coordination, double-refund possible |
| **Crash recovery** | 🟡 Risky | No outbox pattern, side-effects not replayed on restart |
| **State machine coverage** | 🔴 Poor | Only 9 of 25 mutation paths (36%) are gated |
| **Data consistency (MongoDB)** | ✅ Safe | Single-document atomicity, proper indexes |
| **Data consistency (multi-system)** | 🟡 Risky | Google Sheets, Razorpay, WhatsApp are fire-and-forget |

### Must-Fix Before Launch (3 items)

#### 1. Wire state machine into ALL status mutations

Every `order.status = '...'` must go through `transitionStatus()` — especially:
- `chatbot.js` (3 order creations + 2 cancellation paths)
- `refundScheduler.js` (refund + failure)
- `orderScheduler.js` (auto-cancel)
- `deliveryboy.js` (delivery completion)
- `paymentCompletionHandler.js` (4 direct assignments)
- `order.js` admin refund approve/reject (2 paths)

#### 2. Add optimistic concurrency control

Use MongoDB's `__v` field or an atomic `findOneAndUpdate` with status precondition on every mutation:

```js
// INSTEAD OF:
const order = await Order.findById(id);
order.status = 'confirmed';
await order.save();      // ← Last write wins, no concurrency check

// DO:
const order = await Order.findOneAndUpdate(
  { _id: id, status: 'pending' },            // ← Precondition
  { $set: { status: 'confirmed', ... } },
  { new: true }
);
if (!order) throw new Error('Concurrent modification or invalid transition');
```

#### 3. Prevent double refunds

Add a distributed lock or atomic precondition before calling the Razorpay API:

```js
// Atomic claim: only one processor can start the refund
const order = await Order.findOneAndUpdate(
  { _id: id, refundStatus: { $in: ['pending', 'scheduled'] } },
  { $set: { refundStatus: 'processing' } },
  { new: true }
);
if (!order) return; // Already claimed by another processor

// NOW safe to call Razorpay
const refund = await razorpayService.refund(order.razorpayPaymentId, amount);
```

### Should-Fix for Operational Safety (2 items)

#### 4. Add transactional outbox for side effects

Persist side-effect intents (WhatsApp message, Google Sheets update, push notification) as documents in a `pending_events` collection within the same MongoDB transaction as the order update. A separate worker processes and retries them.

#### 5. Add reconciliation cron

A scheduled job that:
- Compares MongoDB order statuses with Google Sheets rows
- Checks Razorpay payment/refund statuses against order records
- Alerts on discrepancies
- Auto-fixes where safe (e.g., re-sync Sheets row)

---

## Appendix: All Status Mutation Points (Quick Reference)

```
File                                          Line    From → To              Gated?
─────────────────────────────────────────────────────────────────────────────────────
routes/order.js                               L214    any → any              ✅ validateTransition()
routes/order.js                               L806    any → refunded         ❌
routes/order.js                               L827    any → refund_failed    ❌
routes/order.js                               L848    any → refunded         ❌
routes/payment.js                             L109    pending → confirmed    ✅ transitionStatus()
routes/payment.js                             L293    any → refunded         ✅ transitionStatus()
routes/payment.js                             L354    any → cancelled        ✅ transitionStatus()
routes/payment.js                             L397    any → confirmed        ✅ transitionStatus()
routes/payment.js                             L473    any → confirmed        ✅ transitionStatus()
routes/payment.js                             L608    any → refunded         ✅ transitionStatus()
routes/payment.js                             L642    any → cancelled        ✅ transitionStatus()
routes/payment.js                             L696    any → refunded         ✅ transitionStatus()
routes/payment.js                             L728    any → cancelled        ✅ transitionStatus()
routes/webhook.js                             L253    pending → confirmed    ✅ transitionStatus()
routes/deliveryboy.js                         L1198   ofd → delivered        ❌ (but uses atomic filter)
services/chatbot.js                           L7967   NEW → confirmed       ❌ (constructor)
services/chatbot.js                           L8500   NEW → pending         ❌ (constructor)
services/chatbot.js                           L8900   any → cancelled       ❌
services/chatbot.js                           L9082   any → cancelled       ❌
services/chatbot.js                           L9349   NEW → pending         ❌ (constructor)
services/orderScheduler.js                    L46     pending → cancelled    ❌
services/refundScheduler.js                   L115    cancelled → refunded   ❌
services/refundScheduler.js                   L148    cancelled → ref_failed ❌
services/domains/orderHandler.js              L137    any → cancelled        ❌
services/domains/paymentCompletionHandler.js  L118    pending → confirmed    ❌
services/domains/paymentCompletionHandler.js  L464    any → refunded         ❌
services/domains/paymentCompletionHandler.js  L590    pending → confirmed    ❌
services/domains/paymentCompletionHandler.js  L652    any → refunded         ❌
```

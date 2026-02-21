# Concurrency & Idempotency Specialist Analysis

**Scope:** Cart mutations, order creation, payment processing, notification dispatch  
**Method:** Static trace of every mutation path, simulated race scenarios  
**Verdict: UNSAFE — 4 critical race conditions, 3 broken idempotency contracts**

---

## 1. CART MUTATION IDEMPOTENCY — `UNSAFE`

### Mechanism
`cartHandler.js` wraps cart mutations in `transactionManager.execute()` with an `idempotencyService.checkCartOperation()` guard.

### What's broken

**A. Transaction is cosmetic — read happens outside the session**

The `customer` object is loaded by the caller (`chatbot.js`) and passed into `addToCart(customer, phone, params)`. Inside the transaction at `cartHandler.js` lines 79–97, `customer.cart` is mutated and `customer.save({ session })` is called — but the **read** of the document happened outside the session boundary. MongoDB snapshot isolation only protects reads **within** the same session. Two concurrent `addToCart` calls:

```
T1: reads customer (cart=[A])  →  pushes B  →  save({session1})  →  cart=[A,B]
T2: reads customer (cart=[A])  →  pushes C  →  save({session2})  →  cart=[A,C]  ← B is lost
```

**B. Bare `customer.save()` after transactional save**

At `cartHandler.js` lines 113–114, after the transaction block, there's an unconditional `await customer.save()` (to persist `conversationState` changes) — this is a **non-transactional full-document replace** that can overwrite concurrent changes.

**C. In-memory idempotency with TOCTOU gap**

`idempotencyService.js` uses a `Map` (line 16). The `checkCartOperation()` returns `{ isDuplicate, mark }` — but `mark()` is called **after** the transaction completes (line 100), not atomically with the duplicate check. Two requests arriving <1ms apart both see `isDuplicate: false`, both proceed.

```
T1: isDuplicate('cart:abc123') → false  →  runs transaction  →  mark()
T2: isDuplicate('cart:abc123') → false  →  runs transaction  →  mark()   ← duplicate!
```

The idempotency cache is also:
- **Lost on restart** — no persistence
- **Single-instance only** — no cross-pod protection
- **30-second TTL** — a retry at 31s bypasses the guard

**D. No atomic operators**

All cart mutations use full-document `save()` instead of `$push` / `$pull` / `$set` with `arrayFilters`. No `executeWithOptimisticLock()` is used despite being available in `transactionManager`.

**E. `updateQuantity` has NO idempotency guard at all**

`addToCart`, `removeFromCart`, `clearCart` all call `checkCartOperation()` — but `updateQuantity` does not.

| Test | Result |
|---|---|
| Two rapid "Add item X" | Both succeed → item quantity doubled |
| Concurrent add + remove | Last-write-wins, one operation lost |
| Process restart mid-operation | Idempotency cache empty, duplicate possible |

---

## 2. ORDER CREATION DEDUPE — `UNSAFE`

### Mechanism
**None.** Despite `idempotencyService.checkOrderOperation()` existing, it is **never called** in any of the 3 order creation functions:
- `processCODOrder` — `chatbot.js` L7855
- `processCheckout` (UPI) — `chatbot.js` L8386
- `processPickupCheckout` — `chatbot.js` L9256

Also duplicated in `paymentInitiationHandler.js` (lines 221, 468) with the same pattern.

### What's broken

**A. `generateOrderId` uses only `Date.now()`**

```js
const generateOrderId = (serviceType = 'delivery') => {
  const prefix = serviceType === 'pickup' ? 'S' : 'O';
  return prefix + 'RD' + Date.now().toString(36).toUpperCase();
};
```

Two requests in the same millisecond produce **identical** orderId values. The Order model has `orderId: { unique: true }` (`Order.js` L4), so the second `save()` would throw E11000 — but **this error is not caught and handled as a duplicate**. It would surface as a 500 error to the user.

**B. Non-atomic cart-read → order-create → cart-clear**

```
L7857: customer = Customer.findOne(phone)     ← read cart
L7870-7987: build Order from cart items        ← construct
L7988: await order.save()                      ← persist order
...
L8065: freshCustomer.cart = []                 ← clear cart (77 lines later!)
L8067: await freshCustomer.save()              ← persist clear
```

Race window: **~200ms** between `order.save` and cart clear. A concurrent checkout reads the same non-empty cart and creates a second order.

**C. No lock, no mutex, no dedup token**

There is zero protection against a user tapping "Confirm" twice. WhatsApp can also deliver duplicate webhook messages (Meta documents at-least-once delivery).

### Simulation: Double Checkout Click

```
T=0ms:   User taps "Confirm COD"
T=5ms:   WhatsApp delivers webhook → T1 starts processCODOrder
T=50ms:  WhatsApp delivers duplicate webhook → T2 starts processCODOrder
T=100ms: T1 reads customer.cart = [{item1, qty:2}]
T=110ms: T2 reads customer.cart = [{item1, qty:2}]  ← same cart!
T=200ms: T1 saves Order#1 (orderId: ORD_ABC)
T=210ms: T2 saves Order#2 (orderId: ORD_ABD or E11000 if same ms)
T=300ms: T1 clears cart
T=310ms: T2 clears cart (already empty, no-op)
Result:  TWO orders created from ONE cart
```

**Can duplicate orders occur? YES — confirmed UNSAFE.**

---

## 3. PAYMENT WEBHOOK IDEMPOTENCY — `CONDITIONAL`

### Mechanism
`PaymentEvent` model with `eventId: { unique: true }`. The webhook handler at `payment.js` L256–264 uses insert + E11000 catch — **correct atomic deduplication**.

### What's broken

**A. PaymentEvent only guards the webhook endpoint**

Three endpoints can mark an order as `paid`:
1. `/verify-upi` — `payment.js` L90–93 — **NO PaymentEvent check**
2. `/razorpay-webhook` — `payment.js` L256 — **PaymentEvent protected ✓**
3. `/callback` — `payment.js` L535–540 — **NO PaymentEvent check**

All three use the same non-atomic pattern:
```js
if (order.paymentStatus !== 'paid') {
  order.paymentStatus = 'paid';
  await order.save();
}
```

No `findOneAndUpdate({ paymentStatus: { $ne: 'paid' } })` — classic TOCTOU.

**B. Cross-endpoint race**

```
T=0ms:   Razorpay captures payment
T=5ms:   /razorpay-webhook fires → reads paymentStatus='pending'
T=10ms:  User's app calls /verify-upi → reads paymentStatus='pending'
T=50ms:  Webhook: order.paymentStatus='paid'; await order.save(); → sends WhatsApp confirmation #1
T=55ms:  verify-upi: order.paymentStatus='paid'; await order.save(); → sends WhatsApp confirmation #2
Result:  Customer gets 2 confirmation messages, admin gets 2 push notifications,
         totalOrders incremented twice, Google Sheet gets 2 rows
```

### What works

- Razorpay webhook events are **correctly deduplicated** via `PaymentEvent.create()` + E11000 catch
- PaymentEvent has a 30-day TTL index — auto-cleanup
- Webhook signature verification is correctly implemented

| Path | Idempotent? |
|---|---|
| Duplicate razorpay-webhook (same eventId) | **SAFE** ✓ |
| verify-upi called twice | **UNSAFE** ✗ |
| callback called twice | **UNSAFE** ✗ |
| webhook + verify-upi concurrent | **UNSAFE** ✗ |

---

## 4. NOTIFICATION DISPATCH IDEMPOTENCY — `UNSAFE`

### Push Notifications
`pushNotification.js` has **zero deduplication**. Every call to `sendNotification()` or `sendAdminNewOrderNotification()` sends unconditionally. Since the payment race (section 3) can trigger confirmation logic from multiple endpoints, every admin receives duplicate push notifications.

### WhatsApp Message Dedup
`idempotencyService.checkOutboundMessage()` exists with a 1-minute TTL, but it suffers the same in-memory TOCTOU issues as the cart guard. It does reduce duplicates from rapid-fire retries but provides no guarantee.

### Badge Count & Stale Tokens
- Badge counts use an in-memory `Map` — **not shared across instances**
- Stale push tokens are tracked in-memory for 24h but **never cleaned from the DB** (`User.pushToken` retains invalid tokens permanently)

---

## 5. MESSAGE PROCESSING IDEMPOTENCY — `SAFE` (with caveats)

### Mechanism
`webhook.js` L540–560 inserts an `InboundMessage` doc with a compound unique index on `(phone, messageId)`. Duplicate inserts throw E11000 and are caught — **correct atomic deduplication**.

### Caveats
1. **No dedup when `message.id` is null** — if the WhatsApp webhook payload lacks a message ID, the entire dedup block is skipped
2. **`messageProcessor.js` is never used** — the webhook handler calls `chatbot.handleMessage` directly, bypassing the `processInboundMessage` pipeline
3. **InboundMessage status** is set to `'processing'` and never updated to `'processed'` — stale records accumulate

| Scenario | Result |
|---|---|
| Same `messageId` delivered twice | **SAFE** — E11000 dedup ✓ |
| `messageId` is null/undefined | **UNSAFE** — no dedup |
| Process crash after insert, before handling | Message stuck as `'processing'`, no auto-retry |

---

## 6. RACE SCENARIO SIMULATIONS

### Scenario A: Duplicate Webhook from Meta
```
Webhook#1 (messageId: wamid.abc) → InboundMessage.create() succeeds → chatbot processes
Webhook#2 (messageId: wamid.abc) → InboundMessage.create() → E11000 → skipped
```
**Result: SAFE** — Atomic insert-based dedup works correctly.

### Scenario B: Double Checkout Click
```
Click#1 → processCheckout → reads cart → creates Order#1 → sends confirmation → clears cart
Click#2 → processCheckout → reads cart (not yet cleared!) → creates Order#2 → sends confirmation → clears cart
```
**Result: UNSAFE** — Two orders, two confirmations, inventory impact doubled.

### Scenario C: Same `messageId` Repeated at 31s
```
T=0s:  webhook dedup → InboundMessage created → message processed
T=31s: same messageId arrives → InboundMessage.create() → E11000 (record exists in DB)
```
**Result: SAFE** — Database-backed dedup doesn't expire (unlike the in-memory TTL cache).

### Scenario D: Parallel Requests from Same User (Cart)
```
T=0ms:  "Add Pizza" → idempotency check → not duplicate → enters transaction
T=2ms:  "Add Burger" → idempotency check → not duplicate (different item) → enters transaction
T=50ms: Pizza save({session1}) → cart=[Pizza]
T=55ms: Burger save({session2}) → cart=[Burger]  ← Pizza is LOST (last-write-wins)
```
**Result: UNSAFE** — Customer-document full replace causes silent data loss.

---

## 7. IS THE IDEMPOTENCY LEDGER ATOMIC?

| Ledger | Backing | Atomic? | Cross-Instance? |
|---|---|---|---|
| `idempotencyService` (cart/order/outbound) | In-memory `Map` | **No** — TOCTOU gap between `isDuplicate()` and `mark()` | **No** |
| `PaymentEvent` (webhook) | MongoDB unique index + E11000 | **Yes** ✓ | **Yes** ✓ |
| `InboundMessage` (message dedup) | MongoDB unique index + E11000 | **Yes** ✓ | **Yes** ✓ |

**Verdict:** Only the two MongoDB-backed ledgers are truly atomic. The in-memory `idempotencyService` is a best-effort filter, not a concurrency guarantee.

---

## 8. RISK CLASSIFICATION MATRIX

| Domain | Classification | Critical Issues |
|---|---|---|
| **Cart Mutations** | **UNSAFE** | Transaction reads outside session; full-doc replace causes lost writes; in-memory idempotency has TOCTOU gap; `updateQuantity` has zero idempotency |
| **Order Creation** | **UNSAFE** | No dedup guard despite `checkOrderOperation()` existing; `Date.now()` orderId can collide; non-atomic cart→order→clear allows double orders |
| **Payment Webhook (Razorpay)** | **SAFE** | PaymentEvent with unique index + E11000 is correct |
| **Payment Processing (cross-endpoint)** | **UNSAFE** | verify-upi, webhook, callback all race on `paymentStatus` via non-atomic read-then-write; no shared identity check |
| **Message Processing** | **SAFE** | InboundMessage unique index + E11000 correct; caveat: no dedup when messageId is null |
| **Push Notifications** | **UNSAFE** | Zero deduplication; payment race amplifies into duplicate admin alerts |
| **Outbound WhatsApp** | **CONDITIONAL** | In-memory dedup reduces rapid-fire but lacks atomicity and persistence |

---

## 9. PRIORITY FIXES

| # | Fix | Effort | Impact |
|---|---|---|---|
| 1 | **Order creation dedup** — Use `findOneAndUpdate({ phone, status: 'pending', createdAt: { $gt: 30s_ago } }, { $setOnInsert: ... }, { upsert: true })` or add `checkOrderOperation()` with a MongoDB-backed ledger | Medium | Prevents double orders — **revenue-critical** |
| 2 | **Atomic payment status** — Replace `if (status !== 'paid') { status='paid'; save() }` with `findOneAndUpdate({ _id, paymentStatus: { $ne: 'paid' } }, { $set: { paymentStatus: 'paid' } })` across all 3 endpoints | Low | Prevents double confirmations |
| 3 | **orderId collision** — Add `crypto.randomBytes(4).toString('hex')` suffix to `generateOrderId` | Trivial | Eliminates ms-collision risk |
| 4 | **Cart atomic ops** — Replace `customer.save()` with `Customer.findOneAndUpdate({ _id }, { $push: { cart: item } })` or enable `optimisticConcurrency: true` on Customer schema | Medium | Prevents lost-write on concurrent cart ops |
| 5 | **Move idempotency to MongoDB/Redis** — Replace in-memory `Map` with a `findOneAndUpdate` upsert on an `IdempotencyKey` collection | Medium | Atomic, persistent, cross-instance |
| 6 | **Notification dedup** — Gate push sends behind the atomic payment update (only send if `findOneAndUpdate` matched) | Low | Prevents duplicate admin alerts |

---

**Overall System Verdict: UNSAFE**  
Two of the three revenue-critical paths (order creation, payment confirmation) have confirmed race conditions that can produce duplicate orders and duplicate payment acknowledgments in production. The only correctly-implemented idempotency mechanisms are `PaymentEvent` (webhook-only) and `InboundMessage` (message dedup) — both use the proven insert + E11000 pattern. Everything else relies on an in-memory cache with a TOCTOU gap.

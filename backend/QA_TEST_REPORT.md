# QA Test Generation Report — Financial-Critical Path Coverage

**Generated**: Phase 6 of Pre-Launch Audit  
**Test Framework**: Jest (unit tests with mocks)  
**Total New Tests**: 206 across 6 test files  
**All Passing**: ✅ 206/206

---

## Test Files Created

| # | File | Tests | Focus |
|---|------|-------|-------|
| 1 | `__tests__/services/orderStateMachine.test.js` | 49 | All valid/invalid state transitions, terminal states, full lifecycle paths |
| 2 | `__tests__/critical/webhookDedup.test.js` | 18 | PaymentEvent E11000 dedup, dedup-before-commit bug, cross-endpoint races, HMAC |
| 3 | `__tests__/critical/paymentFailures.test.js` | 35 | Signature verification, missing fields, amount validation, refund failures |
| 4 | `__tests__/critical/concurrentCheckout.test.js` | 17 | orderId collision, non-atomic order+cart, double-click checkout, payment races |
| 5 | `__tests__/critical/cartIdempotency.test.js` | 27 | IdempotencyService key gen, TOCTOU gap, missing updateQuantity guard |
| 6 | `__tests__/critical/edgeCaseInput.test.js` | 60 | Quantities, prices, empty carts, missing fields, injection, delivery |

---

## 💰 Financial Loss Gaps — Uncovered Areas That Can Cause Revenue Loss

### CRITICAL (Direct Money Loss)

| # | Gap | Risk Level | Current Status | Test Documenting It |
|---|-----|-----------|----------------|---------------------|
| 1 | **Dedup-before-commit in webhook** | 🔴 CRITICAL | PaymentEvent is created BEFORE order.save(). Crash between these = permanent payment loss. Razorpay retry hits E11000 and skips. | `webhookDedup.test.js` → "crash after PaymentEvent.create, before order.save" |
| 2 | **orderId collision (Date.now())** | 🔴 CRITICAL | `generateOrderId()` uses `Date.now().toString(36)` with no random suffix. Same-millisecond orders produce identical IDs → E11000 → order lost. | `concurrentCheckout.test.js` → "same millisecond produces identical IDs" |
| 3 | **Non-atomic order + cart clear** | 🔴 CRITICAL | `order.save()` and `customer.save()` (cart clear) are separate operations, NOT in a transaction. Crash between them → customer retries → duplicate order. | `concurrentCheckout.test.js` → "crash after order.save, before cart.clear" |
| 4 | **Cross-endpoint payment race** | 🔴 HIGH | `verify-upi`, `webhook`, and `callback` can all update the same order concurrently. Only webhook has PaymentEvent dedup. Double WhatsApp notifications + double Google Sheets entries. | `concurrentCheckout.test.js` → "verify-upi + webhook arrive within 10ms" |
| 5 | **verify-upi uses `!==` instead of `timingSafeEqual`** | 🟡 MEDIUM | Timing side-channel on HMAC comparison. Not practically exploitable but inconsistent with webhook handler. | `webhookDedup.test.js` → "verify-upi uses non-timing-safe comparison" |

### HIGH (Financial Integrity)

| # | Gap | Risk Level | Current Status | Test Documenting It |
|---|-----|-----------|----------------|---------------------|
| 6 | **No amount verification on payment** | 🔴 HIGH | Neither `verify-upi` nor `webhook` validates that the Razorpay payment amount matches the order total. Underpayment could be accepted. | `paymentFailures.test.js` → "underpayment should be rejected" |
| 7 | **No guard on `failed → paid` transition** | 🟡 MEDIUM | A webhook arriving late could flip a failed order to paid without re-validation. | `paymentFailures.test.js` → "failed → paid should NOT be allowed" |
| 8 | **No guard on `cancelled → paid`** | 🟡 MEDIUM | Webhook for cancelled order could resurrect it. | `paymentFailures.test.js` → "cancelled → paid should not resurrect" |
| 9 | **updateQuantity missing idempotency** | 🟡 MEDIUM | addToCart, removeFromCart, clearCart all use `checkCartOperation()`. updateQuantity does NOT. Inconsistent; rapid taps unprotected. | `cartIdempotency.test.js` → "updateQuantity does NOT use idempotency guard" |
| 10 | **Idempotency TOCTOU gap** | 🟡 MEDIUM | In-memory Map-based idempotency: check and mark are not atomic. Concurrent requests both pass `isDuplicate: false`. | `cartIdempotency.test.js` → "concurrent isDuplicate checks both return false" |

### MEDIUM (Data Integrity / Operational)

| # | Gap | Risk Level | Current Status | Test Documenting It |
|---|-----|-----------|----------------|---------------------|
| 11 | **Infinity quantity passes guard** | 🟡 MEDIUM | `if (!quantity \|\| quantity < 1)` does not catch Infinity. `Infinity * price = Infinity`. | `edgeCaseInput.test.js` → "quantity as Infinity" |
| 12 | **Negative delivery charge** | 🟡 LOW | No validation on deliveryCharge. Negative value reduces order total. | `edgeCaseInput.test.js` → "delivery charge = negative" |
| 13 | **Floating-point price errors** | 🟡 LOW | `10.10 * 3 = 30.299999999999997` in JavaScript. Not rounded before paise conversion. | `edgeCaseInput.test.js` → "floating point precision" |
| 14 | **Null messageId bypasses dedup** | 🟡 LOW | InboundMessage dedup uses messageId. Null messageId → no dedup → duplicate processing. | `edgeCaseInput.test.js` → "null messageId" |

---

## What's Still NOT Tested (Requires Integration Tests)

These gaps cannot be covered by unit tests alone:

| # | Gap | Why Unit Tests Can't Cover |
|---|-----|---------------------------|
| 1 | Full HTTP request lifecycle (auth → validate → process → respond) | Requires supertest + real Express app |
| 2 | MongoDB transaction behavior (session, commit, rollback) | Requires mongodb-memory-server |
| 3 | Actual concurrent MongoDB writes (race conditions) | Requires parallel HTTP requests to live DB |
| 4 | Redis rate limiter integration | Requires Redis connection |
| 5 | WhatsApp Cloud API webhook signature in real middleware chain | Requires full middleware stack |
| 6 | Google Sheets write dedup | Requires Google API or mock server |
| 7 | Push notification delivery (FCM/APNs) | Requires firebase-admin mock |

**Recommendation**: Install `mongodb-memory-server` and `supertest` to enable integration tests for items 1-3, which cover the highest-risk financial paths.

---

## How to Run

```bash
# All new tests
npx jest __tests__/services/orderStateMachine.test.js __tests__/critical/ --no-coverage

# Individual suites
npx jest __tests__/services/orderStateMachine.test.js
npx jest __tests__/critical/webhookDedup.test.js
npx jest __tests__/critical/paymentFailures.test.js
npx jest __tests__/critical/concurrentCheckout.test.js
npx jest __tests__/critical/cartIdempotency.test.js
npx jest __tests__/critical/edgeCaseInput.test.js
```

---

## Priority Fix Order (by financial impact)

1. **Move PaymentEvent.create AFTER order.save** — prevents permanent payment loss on crash
2. **Add random suffix to generateOrderId** — prevents order loss on collision
3. **Wrap order.save + cart.clear in transaction** — prevents duplicate orders
4. **Use `findOneAndUpdate` with paymentStatus guard** — prevents double WhatsApp/Sheets
5. **Add `isFinite()` check to quantity validation** — prevents Infinity totals
6. **Add idempotency to updateQuantity** — consistency with other cart operations

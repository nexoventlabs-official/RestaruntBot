# Backend Architecture Audit Report

**Date**: February 20, 2026  
**Scope**: 18 route files, 47 service files, 17 models, 9 middleware files, 2 config files  
**Confidence Score: 88/100**

---

## Table of Contents

1. [Critical Issues (Must Fix Before Launch)](#critical-issues-must-fix-before-launch)
2. [Medium Risks](#medium-risks)
3. [Minor Refactors](#minor-refactors)
4. [Fat Routes — Detailed Breakdown](#fat-routes--detailed-breakdown)
5. [Circular Dependencies](#circular-dependencies)
6. [Duplicate Order-Creation Logic](#duplicate-order-creation-logic)
7. [Global Mutable State Inventory](#global-mutable-state-inventory)
8. [Error Handling Anti-Patterns](#error-handling-anti-patterns)
9. [Direct DB Access from Routes](#direct-db-access-from-routes)
10. [Architecture Summary](#architecture-summary)

---

## Critical Issues (Must Fix Before Launch)

### C1. `chatbot` undefined in `messageProcessor.js` — Runtime Crash

**File**: `backend/services/messageProcessor.js` (Line 294)  
**Severity**: 🔴 Crash on invocation

```js
// Line 21 — what's actually imported:
const chatbotRouter = require('./chatbotRouter');

// Line 294 — what's actually called:
await chatbot.handleMessage(   // ← 'chatbot' is NEVER defined
  msg.phone,
  messageContent,
  msg.messageType,
  null,
  null
);
```

Any call to `retryFailedMessages()` throws `ReferenceError: chatbot is not defined`.

**Fix**: Replace `chatbot.handleMessage()` with `chatbotRouter.routeMessage()` (or add `const chatbot = require('./chatbot')` at the top).

---

### C2. Dead code / syntax anomaly in `conversationState.js`

**File**: `backend/services/conversationState.js` (Lines 27–41)

```js
function getState(customer) {
  return customer.conversationState || {
    currentStep: 'welcome',
    selectedService: null,
    selectedCategory: null,
    selectedItem: null,
    pendingOrderId: null,
    foodTypePreference: null,
    paymentMethod: null,
    lastInteraction: new Date(),
    context: {}
  };
const logger = require('./logger');   // ← DEAD CODE: unreachable after return
}
```

`const logger = require('./logger')` at line 40 is **after** the `return` statement and can never execute. If Node.js raises a parse error on this in strict mode, the entire module breaks.

**Fix**: Remove the unreachable `require` statement.

---

### C3. `processCheckout()` missing `paymentMethod` on Order

**File**: `backend/services/chatbot.js` (~Line 8500)

| Function | `paymentMethod` set? |
|---|---|
| `processCODOrder()` (~L7967) | ✅ `paymentMethod: 'cod'` |
| `processPickupCheckout()` (~L9349) | ✅ `paymentMethod: state.paymentMethod \|\| 'cod'` |
| `processCheckout()` (~L8500) | ❌ **Omitted entirely** |

Orders created via the online payment flow have no `paymentMethod` field, falling back to whatever the Mongoose schema default is (likely `undefined`). This breaks payment reconciliation and reporting.

**Fix**: Add `paymentMethod: 'online'` (or the appropriate value) to the `new Order({...})` in `processCheckout()`.

---

### C4. Triple-duplicated order creation logic in `chatbot.js`

**File**: `backend/services/chatbot.js`

Three functions share ~80% identical code:

| Function | Line | Payment | Service Type | Initial Status |
|---|---|---|---|---|
| `processCODOrder()` | ~L7855 | COD | delivery | `confirmed` |
| `processCheckout()` | ~L8386 | online (Razorpay) | delivery | `pending` |
| `processPickupCheckout()` | ~L9256 | COD or online | pickup | `pending` |

**Duplicated blocks** (each appears in all 3 functions):

1. **Cart refresh**: `Customer.findOne({ phone }).populate('cart.menuItem')` + empty cart check
2. **Variant pricing resolution**: ~40 lines of identical `if/else` for `variantIndex`, `quantityIndex`, `offerPrice`
3. **Offer discount calculation**: `calculateOfferDiscount()` + `appliedOfferIds` Set management
4. **Delivery charge calculation** (delivery variants only)
5. **`new Order({...})`** construction with nearly identical fields
6. **Post-order side effects**:
   - Remove applied offers from customer
   - `whatsappBroadcast.addContact()`
   - Set `freshCustomer.hasOrdered = true`
   - `DashboardStats.findOneAndUpdate({ $inc: { todayOrders: 1 } })`
   - `dataEvents.emit('orders')` + `dataEvents.emit('dashboard')`
   - `googleSheets.addOrder(order)`
   - Admin push notification via `pushNotification.sendAdminNewOrderNotification()`

**Subtle divergences between copies that cause bugs**:

- `processCODOrder()` sets `status: 'confirmed'` immediately; others set `status: 'pending'`
- `processCODOrder()` includes `paymentMethod: 'cod'`; `processCheckout()` does NOT (see C3)
- `processPickupCheckout()` sets `deliveryAddress: { address: 'Self-Pickup at Restaurant' }` hardcoded
- `processCheckout()` calls `freshCustomer.save()` inside the `appliedOfferIds` block; `processCODOrder()` does NOT

**Recommendation**: Extract a `createOrder(phone, serviceType, paymentMethod)` helper to eliminate ~300 lines of duplication and prevent divergence bugs.

---

### C5. `orderStateMachine.js` not used by `chatbot.js`

**File**: `backend/services/orderStateMachine.js`

The state machine defines `ALLOWED_TRANSITIONS` and `validateTransition()`. It **is** used by `backend/routes/order.js` (admin status updates), but `chatbot.js` — the **primary order creation path** — sets order statuses directly as strings:

```js
// chatbot.js — processCODOrder()
const order = new Order({ status: 'confirmed', ... });

// chatbot.js — processCheckout()
const order = new Order({ status: 'pending', ... });
```

No transition validation occurs. Invalid status transitions can happen silently.

**Fix**: Wire `chatbot.js` to use `validateTransition()` / `transitionStatus()` from `orderStateMachine.js` for all status changes.

---

### C6. N+1 query problem in `customer.js` route

**File**: `backend/routes/customer.js` (Lines 38–44)

```js
// For EACH customer in the result set:
for (const customer of customers) {
  const orders = await Order.find({ customer: customer._id });      // Query 1 per customer
  const lastOrder = await Order.find({ customer: customer._id })    // Query 2 per customer
    .sort({ createdAt: -1 }).limit(1);
  // ...
}
```

With 500 customers → **1,000 DB queries per request**.

**Fix**: Replace with a single `Order.aggregate()` that groups by `customer` and computes stats in one pass.

---

## Medium Risks

### M1. Fat Routes — 12 of 18 route files contain business logic

No service layer exists for analytics, customers, delivery boys, categories, menu items, offers, orders (admin CRUD), or payments. All logic lives directly in route handlers.

| Route File | Lines | Direct DB Models Used |
|---|---|---|
| `backend/routes/offers.js` | 1,550 | `Offer`, `MenuItem` |
| `backend/routes/deliveryboy.js` | 1,462 | `DeliveryBoy`, `Order` |
| `backend/routes/order.js` | 927 | `Order`, `Customer`, `Settings`, `DashboardStats`, `User`, `DeliveryBoy` |
| `backend/routes/public.js` | 919 | `MenuItem`, `Category`, `Order`, `DeliveryBoy`, `HeroSection`, `Offer` |
| `backend/routes/menu.js` | 863 | `MenuItem` |
| `backend/routes/analytics.js` | 820 | `Order`, `Customer`, `MenuItem`, `DashboardStats` |
| `backend/routes/payment.js` | 749 | `Order`, `Customer`, `PaymentEvent`, `User` |
| `backend/routes/webhook.js` | 579 | `Offer`, `User`, `Order`, `OutboundMessage`, `InboundMessage` |
| `backend/routes/category.js` | 355 | `Category`, `MenuItem` |
| `backend/routes/chatbotImages.js` | 350 | `ChatbotImage` |
| `backend/routes/auth.js` | 184 | `User`, `DeliveryBoy` |
| `backend/routes/customer.js` | 90 | `Customer`, `Order` |

**Clean routes** (delegating to services): `ai.js`, `catalog.js`, `whatsappBroadcast.js`, `settings.js`, `health.js`

---

### M2. Duplicate cleanup services — race condition risk

Three overlapping order cleanup services exist:

| File | Key Function | Purpose |
|---|---|---|
| `backend/services/dailyCleanup.js` | `saveOrderStats(orders)` | Aggregates order stats into `DashboardStats` |
| `backend/services/orderCleanup.js` | `saveOrderStats(orders)` | **Same name, same purpose** — aggregates into `DashboardStats` |
| `backend/services/dataRetention.js` | `cleanCompletedOrders()`, etc. | Deletes old orders by status |

`dailyCleanup.js` and `orderCleanup.js` both:
- Import `Order`, `Customer`, `DashboardStats`, `eventEmitter`
- Have `saveOrderStats()` that computes revenue, counts, and updates DashboardStats
- Clean up completed/old orders

Running all three concurrently creates race conditions on `DashboardStats` updates and could double-count or miss orders.

**Fix**: Consolidate into a single cleanup service with clearly delineated responsibilities, or add distributed locking.

---

### M3. `sendImageWithCtaPhone()` bypasses outbound message tracking

**File**: `backend/services/whatsapp.js`

Every send method in `whatsapp.js` calls `trackOutbound()` to create an `OutboundMessage` record for audit/retry — **except** `sendImageWithCtaPhone()` which calls `metaCloud.sendImageWithCtaPhone()` directly. Messages sent via this method have no outbound record.

**Fix**: Wrap the call with `trackOutbound()` like all other send methods.

---

### M4. Circular dependency chain: orchestrator / chatbotRouter → chatbot.js

```
orchestrator.js  ──requires──▸  chatbot.js (9,475 lines / 464KB)
chatbotRouter.js ──requires──▸  chatbot.js
chatbot.js       ──requires──▸  whatsappBroadcast, googleSheets, razorpay, groqAi, catalogService, ...
```

Both `orchestrator.js` (L16) and `chatbotRouter.js` (L16) directly `require('./chatbot')`. Since `chatbot.js` eagerly requires 12 other service files, this creates a large synchronous load chain at startup.

**Risk**: Node.js resolves circular requires by returning a partially-constructed `module.exports`. If `chatbot.js` hasn't finished executing when `orchestrator.js` or `chatbotRouter.js` access it, they get an incomplete object.

**Fix**: Use lazy requires (inside function bodies) for the chatbot dependency, or break `chatbot.js` into smaller modules.

---

### M5. Triplicated `generateAutoTags()` in `menu.js`

**File**: `backend/routes/menu.js`

The `generateAutoTags()` function is copy-pasted **three times**:
- ~Line 82 (inside `POST /` handler)
- ~Line 248 (inside `PUT /:id` handler)
- ~Line 680 (inside `POST /regenerate-tags` handler)

Any bug fix applied to one copy may be missed in the others.

**Fix**: Extract to a shared utility or service function.

---

### M6. Global mutable state — unbounded in-memory collections

| File | Variable | Type | Risk |
|---|---|---|---|
| `backend/services/pushNotification.js` (L68) | `badgeCounts` | `Map` | Grows with unique push tokens, never evicted |
| `backend/services/pushNotification.js` (L75) | `staleTokens` | `Map` | Grows with stale tokens, never evicted |
| `backend/services/catalogReviewPoller.js` (L13) | `_reviewStatusCache` | `Map` | Unbounded |
| `backend/services/googleSheetsReliable.js` (L22) | `syncErrors` | `Map` | Grows with repeated failures |
| `backend/services/metrics.js` | `responseTimes.domains` | `Object` | Keys grow with unique domain names |
| `backend/services/alerting.js` (L28) | `alertCache` | `Map` | Grows if alert keys proliferate |

**Fix**: Add TTL-based eviction or max-size limits to all unbounded Maps.

---

### M7. Unhandled rejection handler logs but doesn't restart

**File**: `backend/server.js` (Lines 374–376)

```js
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', { reason: reason?.message || reason, stack: reason?.stack });
  // ← Does NOT call forceShutdown() unlike uncaughtException
});
```

An unhandled promise rejection could leave the process in a corrupt state. `uncaughtException` triggers shutdown, but `unhandledRejection` does not.

**Fix**: Either trigger graceful shutdown on unhandled rejections (recommended in production), or ensure all promises are properly caught.

---

## Minor Refactors

### R1. Async functions without `await`

**File**: `backend/routes/auth.js` (Lines 110–125)

`/refresh` and `/revoke` handlers are declared `async` but call purely synchronous functions (`rotateRefreshToken()`, `revokeRefreshToken()`). Remove `async` keyword or make the service functions properly async.

---

### R2. Error-swallowing catch blocks

| Location | Pattern |
|---|---|
| `backend/routes/analytics.js` (L716) | `} catch (e) { // Some system collections may not have stats }` |
| `backend/routes/menu.js` (L336) | `} catch (e) { /* ignore */ }` |
| `backend/routes/menu.js` (L349) | `} catch (e) { /* ignore */ }` |
| `backend/routes/offers.js` (L629) | `try { ... } catch (e) { /* ignore */ }` |
| `backend/services/reportPdf.js` (L119) | `} catch (e) { // Silently fail for individual images }` |
| `backend/routes/auth.js` (L103) | `} catch { res.status(401)... }` — No error variable captured at all |
| `backend/routes/analytics.js` (L51–53) | Logs error but never rethrows — callers don't know it failed |
| `backend/services/chatbot.js` (~L8013) | Logs `statsErr.message` only — discards stack trace |

**Fix**: At minimum, log the error with stack trace. For critical paths, rethrow or return error state.

---

### R3. Inline `require()` calls scattered in route handlers

At least 8 route files use inline `require()` inside handler functions instead of top-level imports:

| File | Inline Require |
|---|---|
| `backend/routes/auth.js` (L165) | `const DeliveryBoy = require('../models/DeliveryBoy')` |
| `backend/routes/order.js` (L278) | `const DashboardStats = require('../models/DashboardStats')` |
| `backend/routes/order.js` (L332) | `const DeliveryBoy = require('../models/DeliveryBoy')` |
| `backend/routes/order.js` (L653) | `const User = require('../models/User')` |
| `backend/routes/webhook.js` (L180) | `const Offer = require('../models/Offer')` |
| `backend/routes/webhook.js` (L193) | `const User = require('../models/User')` |
| `backend/routes/webhook.js` (L558) | `const InboundMessage = require('../models/InboundMessage')` |
| `backend/routes/payment.js` (L158) | `const User = require('../models/User')` |

**Fix**: Move all requires to the top of each file.

---

### R4. Lazy require shadowing in `chatbot.js`

**File**: `backend/services/chatbot.js` (~L7997)

```js
// Top-level import (L11):
const whatsappBroadcast = require('./whatsappBroadcast');

// Inside processCODOrder() (~L7997):
const whatsappBroadcast = require('./whatsappBroadcast');  // ← shadows top-level
```

The lazy local `const` shadows the module-scope binding. Harmless (Node caches modules) but confusing and indicates the lazy require was added without checking existing imports.

**Fix**: Remove the inner `require`.

---

### R5. Hardcoded `defaultImages` array in route file

**File**: `backend/routes/chatbotImages.js` (Lines 35–195)

160 lines of static image definitions (46 entries) hardcoded inline in a route file:

```js
const defaultImages = [
  { key: 'welcome_image', label: 'Welcome Image', defaultUrl: '...', category: 'general' },
  { key: 'menu_header', label: 'Menu Header', defaultUrl: '...', category: 'menu' },
  // ... 44 more entries
];
```

**Fix**: Move to a config/seed file (e.g., `config/defaultChatbotImages.js`).

---

### R6. HTML email template hardcoded in route file

**File**: `backend/routes/deliveryboy.js` (Lines 56–107)

The `sendPasswordEmail()` function constructs a full HTML email template inline in the route file (~50 lines of HTML string concatenation).

**Fix**: Move to a template file or the `brevoMail` service.

---

### R7. Multiple competing `process.on` signal handlers

| File | Handlers Registered |
|---|---|
| `backend/server.js` (L365) | `SIGTERM`, `SIGINT` → `forceShutdown()` |
| `backend/services/redis.js` | `SIGTERM`, `SIGINT` → own shutdown |
| `backend/services/messageQueue.js` | `SIGTERM`, `SIGINT` → own shutdown |

These compete with the graceful shutdown in `server.js` and may cause unpredictable shutdown behavior.

**Fix**: Centralize all shutdown logic in `server.js` and have it call cleanup functions on each service.

---

## Fat Routes — Detailed Breakdown

### `backend/routes/analytics.js` (820 lines)

| Endpoint | Lines | What It Does Inline |
|---|---|---|
| `GET /dashboard` | L57–138 | 13 parallel DB queries, inline stats merging |
| `GET /sales` | L140–157 | Inline aggregation pipeline |
| `GET /top-items` | L159–171 | Inline aggregation pipeline |
| `GET /report` | L189–600 | 7 parallel DB queries, historical data merging, variant/category cross-referencing, revenue trend computation |
| `POST /sync-today-revenue` | L610–640 | Inline aggregation + stats upsert |
| `GET /storage` | L680–820 | Inline MongoDB `db.stats()` + Cloudinary API usage fetch |

### `backend/routes/deliveryboy.js` (1,462 lines)

| Endpoint | Lines | What It Does Inline |
|---|---|---|
| `sendPasswordEmail()` | L56–107 | HTML email template construction |
| `GET /` | L110–140 | Real-time online status calculation |
| `POST /` | L143–213 | Delivery boy creation with cloudinary upload, email send |
| `POST /login` | L333–392 | Auth with phone/email detection, JWT generation |
| `POST /orders/:id/delivered` | L1050–1200 | Delivery completion: COD handling, Google Sheets, WhatsApp, stats, cleanup |
| `POST /orders/:id/generate-qr` | L1200–1340 | UPI deep link generation + QR code |
| `GET /orders/:id/check-payment` | L1340–1462 | Razorpay payment status check with auto-delivery completion |

### `backend/routes/offers.js` (1,550 lines)

| Endpoint | Lines | What It Does Inline |
|---|---|---|
| `POST /` | L103–500 | ~400 lines: image uploads, targeting, offer price calculation per item/variant/quantity, Meta template submission |
| `PUT /:id` | L752–1050 | ~300 lines: image management, price recalculation, variant-level discount management |
| `DELETE /:id` | L1050–1330 | Image cleanup, removal of offer prices from all affected menu items |
| `PATCH /:id/toggle` | L1340–1550 | ~200 lines: activating/deactivating offers and recalculating prices |

### `backend/routes/order.js` (927 lines)

| Endpoint | Lines | What It Does Inline |
|---|---|---|
| `PUT /:id/status` | L190–670 | **~480 lines**: state machine, dashboard stats update, Google Sheets sync, WhatsApp notifications per status, email, push notifications, refund setup, instant cleanup with `setTimeout` |
| `PUT /:id/assign-delivery` | L710–850 | Assignment with push notification, email, Google Sheets |
| `POST /:id/refund/approve` | L885–927 | Inline refund processing with Razorpay API |

### `backend/routes/payment.js` (749 lines)

| Endpoint | Lines | What It Does Inline |
|---|---|---|
| `POST /create-upi-order` | L17–61 | Order validation + amount verification + Razorpay order creation |
| `POST /verify-upi` | L64–176 | Signature verification, amount matching, order confirmation, WhatsApp, email, customer stats, push |
| `POST /razorpay-webhook` | L179–380 | HMAC timing-safe comparison, idempotency via `PaymentEvent`, refund handling, payment capture fallback |
| `GET /callback` | L382–590 | Payment callback with inline HTML response rendering |
| `POST /refund/:orderId` | L590–749 | Razorpay refund processing |

### `backend/routes/public.js` (919 lines)

| Endpoint | Lines | What It Does Inline |
|---|---|---|
| `GET /offers/:id/check-eligibility` | L133–208 | Phone normalization and targeted offer eligibility checking |
| `POST /customer/active-offers` | L211–330 | Discount price calculation across items/variants/categories |
| `GET /categories` | L332–420 | Category status computation with schedule logic |
| `GET /menu` | L422–560 | Item status computation (available/unavailable/soldout) with category/schedule/offer cross-refs |
| `GET/POST /review/:phone/:orderId` | L565–700 | Rating submission with per-variant average recalculation |

---

## Circular Dependencies

### Chain A — The Orchestrator Triangle

```
orchestrator.js  ──requires──▸  chatbot.js (9,475 lines)
                                    │
chatbotRouter.js ──requires──▸  chatbot.js
                                    │
chatbot.js ──requires──▸ whatsappBroadcast.js
                         googleSheets.js
                         razorpay.js
                         groqAi.js
                         catalogService.js
                         ... (12 total services)
```

### Chain B — Lazy-Require Shadowing

```
chatbot.js (L11)   ──requires──▸  whatsappBroadcast.js   (top-level)
chatbot.js (L7997) ──requires──▸  whatsappBroadcast.js   (lazy, shadows L11)
```

### Chain C — messageProcessor → chatbotRouter → chatbot

```
messageProcessor.js ──requires──▸ chatbotRouter.js ──requires──▸ chatbot.js
      │
      └── L294: calls chatbot.handleMessage() ← UNDEFINED (see C1)
```

### Chain D — polling → chatbot

```
polling.js ──requires──▸ chatbot.js (direct import, another entry point)
```

### No circular deps in:
`alerting`, `brevoMail`, `cache`, `cloudinary`, `eventEmitter`, `googleSheets`, `groqAi`, `logger`, `metaCloud`, `metrics`, `pushNotification`, `razorpay`, `redis`, `reportPdf`, `transactionManager`, `orderStateMachine`

---

## Duplicate Order-Creation Logic

### Three Near-Identical Functions in `chatbot.js`

| Function | Line | Payment | Service Type | Status | `paymentMethod` Set? |
|---|---|---|---|---|---|
| `processCODOrder()` | ~L7855 | COD | delivery | `confirmed` | ✅ `'cod'` |
| `processCheckout()` | ~L8386 | online | delivery | `pending` | ❌ **Missing** |
| `processPickupCheckout()` | ~L9256 | COD/online | pickup | `pending` | ✅ `state.paymentMethod` |

### Three Overlapping Cleanup Services

| File | Function | Purpose |
|---|---|---|
| `dailyCleanup.js` | `saveOrderStats(orders)` | Aggregates into DashboardStats |
| `orderCleanup.js` | `saveOrderStats(orders)` | **Same name, same purpose** |
| `dataRetention.js` | `cleanCompletedOrders()` | Deletes old orders by status |

### Order Status Management Spread

| File | Role |
|---|---|
| `orderStateMachine.js` | Defines `ALLOWED_TRANSITIONS` + `validateTransition()` |
| `orderScheduler.js` | Auto-cancels expired pending orders (15min timeout) |
| `refundScheduler.js` | Processes refunds for cancelled orders |
| `googleSheets.js` | `updateOrderStatus()` — moves orders between sheets |
| `chatbot.js` | Creates orders, handles cancel/refund intents — **bypasses state machine** |

---

## Global Mutable State Inventory

### In-Memory Maps / Sets / Objects

| File | Variable | Line | Type | Eviction? | Risk |
|---|---|---|---|---|---|
| `alerting.js` | `alertCache` | L28 | `Map` | ❌ | Unbounded growth |
| `cartCleanup.js` | `warnedCustomers` | L8 | `Set` | ❌ | Never cleared between cron runs |
| `catalogRatingSync.js` | `schedulerTask` | L18 | `let` | N/A | Singleton cron ref |
| `catalogReviewPoller.js` | `_reviewStatusCache` | L13 | `Map` | ❌ | Unbounded growth |
| `catalogService.js` | `_catalogCache` | L24 | `Object` | TTL | Single-entry, safe |
| `chatbot.js` | `_menuCache` | L33 | `Object` | TTL | Single-entry, safe |
| `chatbot.js` | `_activeOffersCache` | L53 | `Map` | TTL | Bounded by offer count |
| `chatbot.js` | `_translationCache` | L76 | `Map` | ✅ LRU | Bounded by `TRANSLATION_CACHE_MAX` |
| `chatbotImages.js` | `imageCache` | L6 | `Object` | TTL | Bounded by image count |
| `circuitBreaker.js` | `circuitBreakers` | L160 | `Object` | ❌ | Bounded by breaker count |
| `googleSheets.js` | `customerCache` | L23 | `Object` | TTL | Single-entry, safe |
| `googleSheetsReliable.js` | `syncErrors` | L22 | `Map` | ❌ | Grows with failures |
| `groqAi.js` | `groq` | L4 | `let` | N/A | Singleton SDK instance |
| `idempotencyService.js` | `idempotencyCache` | L11 | `Map` | ✅ 60s | Has cleanup interval |
| `jwtRefresh.js` | `refreshTokens` | L16 | `Map` | ✅ 1hr | Has cleanup interval |
| `jwtRefresh.js` | `blacklistedTokens` | L17 | `Set` | ✅ 1hr | Has cleanup interval |
| `metrics.js` | `metrics` object | L15 | `Object` | Partial | Arrays capped at 1000; domain keys unbounded |
| `polling.js` | `isPolling` + `pollInterval` | L8–9 | `let` | N/A | Singleton flags |
| `pushNotification.js` | `badgeCounts` | L68 | `Map` | ❌ | Grows with unique tokens |
| `pushNotification.js` | `staleTokens` | L75 | `Map` | ❌ | Grows with stale tokens |
| `razorpay.js` | `razorpay` + `lastKeyId` | L4–5 | `let` | N/A | Singleton, safe |
| `refundScheduler.js` | `pendingRefunds` | L8 | `Map` | ✅ | Cleared after processing |

### Global Side Effects at Module Load

| File | Effect |
|---|---|
| `idempotencyService.js` | `setInterval(cleanExpired, 60 * 1000)` at module level |
| `jwtRefresh.js` | `setInterval(cleanupExpiredTokens, 60*60*1000).unref()` at module level |
| `redis.js` | `process.on('SIGTERM')` + `process.on('SIGINT')` at module level |
| `messageQueue.js` | `process.on('SIGTERM')` + `process.on('SIGINT')` at module level |

---

## Error Handling Anti-Patterns

### Empty / Silent Catch Blocks

| File | Line | Code | Severity |
|---|---|---|---|
| `routes/analytics.js` | L716 | `} catch (e) { // Some system collections may not have stats }` | Low |
| `routes/menu.js` | L336 | `} catch (e) { /* ignore */ }` | Medium |
| `routes/menu.js` | L349 | `} catch (e) { /* ignore */ }` | Medium |
| `routes/offers.js` | L629 | `try { ... } catch (e) { /* ignore */ }` | Medium |
| `services/reportPdf.js` | L119 | `} catch (e) { // Silently fail for individual images }` | Medium |

### Catch Without Error Variable

| File | Line | Code |
|---|---|---|
| `routes/auth.js` | L103 | `} catch { res.status(401)... }` — JWT verification error completely discarded |

### Catch That Logs But Discards Stack

| File | Pattern |
|---|---|
| `services/chatbot.js` (~L8013) | `logger.error('Error', { error: statsErr.message })` — `.message` only, no `.stack` |
| `routes/analytics.js` (L51–53) | Logs error but never rethrows — callers silently continue |

### Best-Effort Patterns (Intentional but Should Log)

| File | Line | Purpose |
|---|---|---|
| `routes/category.js` | L98, L108, L315, L325 | Cloudinary delete — logs warning, continues |
| `routes/deliveryboy.js` | L248, L293 | Old photo cleanup — logs info, continues |
| `routes/chatbotImages.js` | L208 | Default image creation — logs error, continues loop |

---

## Direct DB Access from Routes

### Summary by Route File

| Route File | Models Accessed Directly | Notable Queries |
|---|---|---|
| `analytics.js` | `Order`, `Customer`, `MenuItem`, `DashboardStats` | 13 parallel queries in dashboard; `mongoose.connection.db.stats()` |
| `auth.js` | `User`, `DeliveryBoy` | `User.findOne`, `new User().save()`, `User.updateMany`, `DeliveryBoy.updateMany` |
| `category.js` | `Category`, `MenuItem` | Full CRUD + cascading deletes with `MenuItem.findByIdAndDelete` |
| `chatbotImages.js` | `ChatbotImage` | 9 direct model calls |
| `customer.js` | `Customer`, `Order` | N+1 loop with 2 queries per customer |
| `deliveryboy.js` | `DeliveryBoy`, `Order` | Extensive: find, create, update, delete throughout 1,462 lines |
| `heroSection.js` | `HeroSection` | Full CRUD (simple model, borderline acceptable) |
| `menu.js` | `MenuItem` | Full CRUD + `updateMany`, `distinct` |
| `offers.js` | `Offer`, `MenuItem` | Full CRUD + variant-level price recalculation in loops |
| `order.js` | `Order`, `Customer`, `Settings`, `DashboardStats`, `User`, `DeliveryBoy` | 6 models accessed, inline requires |
| `payment.js` | `Order`, `Customer`, `PaymentEvent`, `User` | HMAC verification + idempotency + refund processing |
| `public.js` | `MenuItem`, `Category`, `Order`, `DeliveryBoy`, `HeroSection`, `Offer` | 6 models, complex status computation |
| `settings.js` | `Settings` | Model statics (borderline acceptable) |
| `webhook.js` | `Offer`, `User`, `Order`, `OutboundMessage`, `InboundMessage` | 5 models via inline requires |
| `whatsappBroadcast.js` | `Offer` | 1 inline require |

### Routes With NO Direct DB Access (Clean)

- `ai.js` — delegates to `groqAi` service
- `catalog.js` — delegates to `catalogService` (except one direct Meta API call)
- `health.js` — only `mongoose.connection.readyState` (appropriate)

---

## Architecture Summary

```
Category                    Count    Severity
───────────────────────────────────────────────
Critical issues               6     Block launch
Medium risks                  7     Fix in sprint 1
Minor refactors               7     Backlog
───────────────────────────────────────────────
Total findings               20
```

### Confidence Score: 88/100

**Deductions**:
- -7 points: The 9,475-line `chatbot.js` was sampled rather than read line-by-line in full
- -5 points: Domain handler files under `services/domains/` and `services/googleSheets/` subdirectory were not audited

### Top 3 Priorities

1. **Fix `messageProcessor.js` crash** (C1) — one-line fix, prevents runtime `ReferenceError`
2. **Extract shared `createOrder()` from `chatbot.js`** (C4) — eliminates C3, C5, and ~300 lines of divergent duplication
3. **Create service layer for top 4 fat routes**: `offers`, `deliveryboy`, `order`, `payment` (M1) — move business logic out of route handlers

### Service Layer Coverage

```
Has Service Layer          Missing Service Layer
─────────────────          ─────────────────────
AI (groqAi)                Analytics
Catalog (catalogService)   Auth
Chatbot (chatbot)          Category
WhatsApp (whatsapp)        Customer
Broadcast (whatsappBrd)    Delivery Boy
Google Sheets              Hero Section
Push Notifications         Menu Items
Razorpay                   Offers
Cloudinary                 Orders (admin CRUD)
                           Payments
                           Public API
                           Webhook Processing
```

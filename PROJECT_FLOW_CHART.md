# 🍽️ Complete Food Delivery System - Flow Chart & Architecture

## 📋 Table of Contents
1. [System Overview](#system-overview)
2. [Technology Stack](#technology-stack)
3. [User Flows](#user-flows)
4. [System Architecture](#system-architecture)
5. [Database Models](#database-models)
6. [API Endpoints](#api-endpoints)
7. [External Integrations](#external-integrations)
8. [Real-time Features](#real-time-features)

---

## 🎯 System Overview

This is a **complete food delivery ecosystem** with 4 main components:

### **Components:**
1. **Customer Website** (React + Vite) - Browse menu, place orders
2. **WhatsApp Chatbot** (AI-powered) - Order via WhatsApp with voice support
3. **Admin Mobile App** (React Native + Expo) - Manage orders, menu, delivery
4. **Delivery Partner Mobile App** (React Native + Expo) - Accept & deliver orders

### **Key Features:**
- 🤖 AI-powered WhatsApp chatbot with multi-language support
- 💳 Online payments (Razorpay) + Cash on Delivery
- 📱 Real-time push notifications
- 🗺️ Google Maps navigation for delivery
- ⭐ Customer ratings & reviews
- 📊 Real-time dashboard with SSE
- 📧 Email notifications (Brevo)
- 📈 Google Sheets integration for analytics
- 🖼️ Image management (Cloudinary)

---

## 💻 Technology Stack

### **Frontend (Customer Website)**
```
React 18.2.0
Vite 5.0.10
React Router DOM 6.21.1
Axios 1.6.2
GSAP 3.14.2 (animations)
Lenis 1.3.17 (smooth scroll)
Tailwind CSS 3.4.0
Lucide React (icons)
```

### **Mobile Apps (Admin & Delivery)**
```
React Native 0.81.5
Expo SDK 54.0.31
React Navigation 6.1.9
Axios 1.6.2
Expo Notifications 0.32.16
Expo Location 19.0.8
Expo Haptics 15.0.8
Lottie React Native 7.3.5
```

### **Backend (Node.js)**
```
Express 4.18.2
MongoDB + Mongoose 8.0.3
JWT (jsonwebtoken 9.0.2)
Bcrypt (bcryptjs 2.4.3)
Razorpay SDK 2.9.2
Expo Server SDK 4.0.0
Cloudinary 2.8.0
Brevo API (sib-api-v3-sdk 8.5.0)
Google APIs 167.0.0
Groq AI SDK 0.3.2
Node Cron 3.0.3
Multer 1.4.5
PDFKit 0.17.2
```

---


## 🔄 Complete User Flows

### **FLOW 1: Customer Orders via Website**

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CUSTOMER WEBSITE FLOW                            │
└─────────────────────────────────────────────────────────────────────┘

1. Customer visits website (https://restarunt-bot.vercel.app)
   ↓
2. Browse Menu
   - View categories (Veg/Non-Veg/Egg/All)
   - Search items
   - Filter by food type
   - View item details (price, rating, prep time)
   - Add to cart or wishlist
   ↓
3. Cart Management
   - View cart sidebar
   - Update quantities
   - Apply offers
   - Calculate total
   ↓
4. Checkout (via WhatsApp)
   - Click "Order via WhatsApp"
   - Redirects to WhatsApp with pre-filled message
   - Customer sends message to chatbot
   ↓
5. WhatsApp Chatbot Takes Over
   - Confirms items
   - Collects delivery address
   - Offers payment options (UPI/COD)
   - Creates order in database
   ↓
6. Payment
   - UPI: Razorpay payment link sent
   - COD: Order confirmed directly
   ↓
7. Order Tracking
   - Real-time status updates via WhatsApp
   - Track order page on website
   - Push notifications (if app installed)
   ↓
8. Delivery
   - Delivery partner assigned
   - Customer receives updates
   - Order delivered
   ↓
9. Post-Delivery
   - Review link sent via WhatsApp
   - Customer rates order & delivery partner
   - Feedback stored in database
```

---

### **FLOW 2: Customer Orders via WhatsApp Chatbot**

```
┌─────────────────────────────────────────────────────────────────────┐
│                  WHATSAPP CHATBOT FLOW (AI-POWERED)                 │
└─────────────────────────────────────────────────────────────────────┘

1. Customer sends "Hi" to WhatsApp number
   ↓
2. Chatbot Welcome Message
   - Greeting with restaurant name
   - Main menu buttons:
     • 📋 View Menu
     • 🛒 My Cart
     • 📦 My Orders
     • ℹ️ About Us
   ↓
3. View Menu
   - Shows categories with images
   - Customer selects category
   - Displays items with:
     • Image
     • Name & description
     • Price & offers
     • Rating
     • Food type (Veg/Non-Veg/Egg)
   ↓
4. Add to Cart
   - Customer clicks "Add to Cart"
   - Quantity selection
   - Item added to cart
   - Cart summary shown
   ↓
5. Checkout
   - Customer clicks "Checkout"
   - Cart items displayed with total
   - Delivery address collection:
     • Text address OR
     • Share location (GPS)
   ↓
6. Payment Method Selection
   - UPI (Online Payment)
   - COD (Cash on Delivery)
   ↓
7. Order Confirmation
   - Order ID generated (ORD + timestamp)
   - Order saved to MongoDB
   - Synced to Google Sheets
   ↓
8. Payment Processing
   - UPI: Razorpay payment link sent
     • Customer pays online
     • Webhook confirms payment
     • Order status → "confirmed"
   - COD: Order confirmed immediately
   ↓
9. Order Status Updates (Real-time)
   - Pending → Confirmed → Preparing → Ready → Out for Delivery → Delivered
   - Each status change:
     • WhatsApp message sent
     • Email sent (if available)
     • Push notification (if app installed)
     • Google Sheets updated
   ↓
10. Delivery
    - Delivery partner assigned
    - Customer gets partner details
    - Real-time tracking available
    ↓
11. Order Delivered
    - Status updated to "Delivered"
    - Bill sent via WhatsApp
    - Review link sent
    - COD payment marked as paid
   ↓
12. Review & Rating
    - Customer clicks review link
    - Rates order (1-5 stars)
    - Rates delivery partner (1-5 stars)
    - Feedback saved to database

```

---


### **FLOW 3: Admin Mobile App**

```
┌─────────────────────────────────────────────────────────────────────┐
│                      ADMIN MOBILE APP FLOW                          │
└─────────────────────────────────────────────────────────────────────┘

1. Admin Login
   - Username: admin
   - Password: admin (from .env)
   - JWT token generated
   - Push notification token registered
   ↓
2. Dashboard (Home Screen)
   - Today's revenue
   - Total revenue
   - Order statistics
   - Pending orders count
   - Preparing orders count
   - Out for delivery count
   - Recent orders list
   - Real-time updates via SSE
   ↓
3. Orders Management
   - View all orders (tabs):
     • All
     • Pending
     • Preparing
     • Ready
     • Out for Delivery
     • Delivered
     • Cancelled
   - Pull to refresh
   - Real-time updates
   ↓
4. Order Details
   - Customer info
   - Items list
   - Total amount
   - Payment status
   - Delivery address
   - Timeline
   ↓
5. Order Actions
   - Update status:
     • Pending → Confirmed
     • Confirmed → Preparing
     • Preparing → Ready
     • Ready → Out for Delivery
     • Out for Delivery → Delivered
     • Any → Cancelled
   - Assign delivery partner
   - Set estimated delivery time
   - Each action:
     • Updates database
     • Sends WhatsApp notification
     • Sends email notification
     • Sends push notification
     • Updates Google Sheets
   ↓
6. Menu Management
   - View all menu items
   - Add new item:
     • Name, description
     • Price, offer price
     • Category (multiple)
     • Food type (Veg/Non-Veg/Egg)
     • Image upload (Cloudinary)
     • Preparation time
     • Tags
   - Edit item
   - Delete item
   - Pause/unpause item
   ↓
7. Offers Management
   - Create offers
   - Edit offers
   - Delete offers
   - Set offer validity
   ↓
8. Delivery Partners Management
   - View all delivery partners
   - Add new partner:
     • Name, email, phone
     • Password
     • Date of birth
     • Photo upload
   - Edit partner details
   - Reset password
   - Activate/deactivate
   - View ratings
   - View delivery history
   ↓
9. Reports
   - Daily sales report
   - Order statistics
   - Revenue analytics
   - Export to PDF
   - Email report
   ↓
10. Notifications
    - View all notifications
    - New order alerts
    - Order status updates
    - Delivery partner updates
    - Mark as read
```

---


### **FLOW 4: Delivery Partner Mobile App**

```
┌─────────────────────────────────────────────────────────────────────┐
│                 DELIVERY PARTNER MOBILE APP FLOW                    │
└─────────────────────────────────────────────────────────────────────┘

1. Delivery Partner Login
   - Email & password
   - JWT token generated
   - Push notification token registered
   ↓
2. Home Screen (Dashboard)
   - Online/Offline toggle
   - Today's stats:
     • Earnings
     • Deliveries completed
     • Active orders
     • Average rating
   - Quick actions
   - Pull to refresh
   ↓
3. Available Orders (When Online)
   - View orders with status "Ready"
   - Order details:
     • Order ID
     • Items count
     • Total amount
     • Delivery address
     • Distance
     • Payment method
   - Claim order button
   ↓
4. Claim Order
   - Order assigned to delivery partner
   - Status updated to "Out for Delivery"
   - Admin notified
   - Customer notified
   - Order moves to "My Orders"
   ↓
5. My Orders (Active Deliveries)
   - View assigned orders
   - Order details:
     • Customer name & phone
     • Delivery address
     • Items list
     • Total amount
     • Payment method
   - Actions:
     • Call customer
     • Navigate (Google Maps)
     • Mark as delivered
   ↓
6. Navigation
   - Get current location
   - Open Google Maps with directions
   - Route from current location to delivery address
   ↓
7. Mark as Delivered
   - Confirmation dialog
   - Status updated to "Delivered"
   - Database updated
   - Customer notified
   - Admin notified
   - Google Sheets updated
   - COD payment marked as paid
   - Earnings updated
   ↓
8. Delivery History
   - View completed deliveries
   - Filter by date
   - View earnings
   - View ratings received
   ↓
9. Profile
   - View personal info
   - View statistics:
     • Total deliveries
     • Total earnings
     • Average rating
     • Total ratings
   - Change password
   - Update photo
   - Logout
   ↓
10. Notifications
    - New order assigned
    - Order cancelled
    - Rating received
    - System announcements
```

---


## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SYSTEM ARCHITECTURE                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Customer Web    │     │  Admin Mobile    │     │ Delivery Mobile  │
│  (React + Vite)  │     │  (React Native)  │     │ (React Native)   │
│                  │     │                  │     │                  │
│  - Browse Menu   │     │  - Dashboard     │     │  - Accept Orders │
│  - Add to Cart   │     │  - Manage Orders │     │  - Navigation    │
│  - WhatsApp Link │     │  - Manage Menu   │     │  - Delivery      │
│  - Track Order   │     │  - Delivery Mgmt │     │  - Earnings      │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
                                  │ HTTPS/REST API
                                  │
                    ┌─────────────▼──────────────┐
                    │                            │
                    │   BACKEND (Node.js)        │
                    │   Express + MongoDB        │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │  API Routes          │  │
                    │  │  - /api/auth         │  │
                    │  │  - /api/menu         │  │
                    │  │  - /api/orders       │  │
                    │  │  - /api/payment      │  │
                    │  │  - /api/delivery     │  │
                    │  │  - /api/customers    │  │
                    │  │  - /api/webhook      │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │  Services            │  │
                    │  │  - WhatsApp          │  │
                    │  │  - Chatbot (AI)      │  │
                    │  │  - Razorpay          │  │
                    │  │  - Push Notifications│  │
                    │  │  - Email (Brevo)     │  │
                    │  │  - Google Sheets     │  │
                    │  │  - Cloudinary        │  │
                    │  └──────────────────────┘  │
                    │                            │
                    │  ┌──────────────────────┐  │
                    │  │  Schedulers (Cron)   │  │
                    │  │  - Order Cleanup     │  │
                    │  │  - Cart Cleanup      │  │
                    │  │  - Daily Cleanup     │  │
                    │  │  - Refund Scheduler  │  │
                    │  └──────────────────────┘  │
                    │                            │
                    └────────────┬───────────────┘
                                 │
                    ┌────────────┴───────────────┐
                    │                            │
         ┌──────────▼──────────┐    ┌───────────▼──────────┐
         │   MongoDB Atlas     │    │  External Services   │
         │                     │    │                      │
         │  Collections:       │    │  - Meta WhatsApp API │
         │  - users            │    │  - Razorpay API      │
         │  - orders           │    │  - Groq AI API       │
         │  - menuitems        │    │  - Brevo Email API   │
         │  - customers        │    │  - Google Sheets API │
         │  - deliveryboys     │    │  - Cloudinary API    │
         │  - categories       │    │  - Expo Push API     │
         │  - offers           │    │                      │
         │  - dashboardstats   │    │                      │
         └─────────────────────┘    └──────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    WHATSAPP CHATBOT FLOW                            │
└─────────────────────────────────────────────────────────────────────┘

Customer WhatsApp Message
         │
         ▼
Meta WhatsApp Cloud API
         │
         ▼
Webhook (/api/webhook/whatsapp)
         │
         ▼
Chatbot Service (chatbot.js)
         │
         ├─► AI Intent Detection (Groq AI)
         │   - Detect: order, cancel, refund, cart, menu
         │   - Multi-language support (9 languages)
         │   - Voice message support
         │
         ├─► Customer Management
         │   - Find or create customer
         │   - Update cart
         │   - Track order history
         │
         ├─► Menu Service
         │   - Fetch categories
         │   - Fetch items
         │   - Check availability
         │   - Apply offers
         │
         ├─► Order Processing
         │   - Create order
         │   - Generate order ID
         │   - Save to MongoDB
         │   - Sync to Google Sheets
         │
         ├─► Payment Integration
         │   - Create Razorpay payment link
         │   - Send payment link via WhatsApp
         │   - Handle payment callback
         │
         └─► Response Generation
             - Format messages
             - Add images (Cloudinary)
             - Add buttons/lists
             - Send via WhatsApp API
```

---


## 📊 Database Models & Relationships

```
┌─────────────────────────────────────────────────────────────────────┐
│                        DATABASE SCHEMA                              │
└─────────────────────────────────────────────────────────────────────┘

┌──────────────────────┐
│      User            │
├──────────────────────┤
│ _id                  │
│ username             │
│ password (hashed)    │
│ role (admin/staff)   │
│ pushToken            │
│ createdAt            │
└──────────────────────┘

┌──────────────────────┐
│   DeliveryBoy        │
├──────────────────────┤
│ _id                  │
│ name                 │
│ email                │
│ phone                │
│ password (hashed)    │
│ photo                │
│ dob                  │
│ age                  │
│ isActive             │
│ isOnline             │
│ lastActiveAt         │
│ pushToken            │
│ ratings []           │
│ avgRating            │
│ totalRatings         │
│ totalDeliveries      │
│ totalEarnings        │
│ tokenVersion         │
└──────────────────────┘
         │
         │ assignedTo
         │
         ▼
┌──────────────────────┐
│      Order           │
├──────────────────────┤
│ _id                  │
│ orderId (unique)     │
│ customer {}          │
│   - phone            │
│   - name             │
│   - email            │
│   - address          │
│ deliveryAddress {}   │
│   - address          │
│   - latitude         │
│   - longitude        │
│ items []             │
│   - menuItem (ref)   │
│   - name             │
│   - quantity         │
│   - price            │
│   - image            │
│ totalAmount          │
│ status               │
│ serviceType          │
│ paymentMethod        │
│ paymentStatus        │
│ razorpayOrderId      │
│ razorpayPaymentId    │
│ refundId             │
│ refundStatus         │
│ assignedTo (ref)     │
│ deliveryPartnerName  │
│ trackingUpdates []   │
│ estimatedDeliveryTime│
│ deliveredAt          │
│ createdAt            │
│ updatedAt            │
└──────────────────────┘
         │
         │ items.menuItem
         │
         ▼
┌──────────────────────┐
│     MenuItem         │
├──────────────────────┤
│ _id                  │
│ name                 │
│ description          │
│ price                │
│ offerPrice           │
│ originalPrice        │
│ category []          │
│ image                │
│ unit                 │
│ quantity             │
│ foodType             │
│ offerType []         │
│ available            │
│ isPaused             │
│ preparationTime      │
│ tags []              │
│ ratings []           │
│ avgRating            │
│ totalRatings         │
│ isActive             │
└──────────────────────┘
         │
         │ category
         │
         ▼
┌──────────────────────┐
│     Category         │
├──────────────────────┤
│ _id                  │
│ name                 │
│ description          │
│ image                │
│ isActive             │
│ isPaused             │
│ displayOrder         │
└──────────────────────┘

┌──────────────────────┐
│     Customer         │
├──────────────────────┤
│ _id                  │
│ phone (unique)       │
│ name                 │
│ email                │
│ address              │
│ cart []              │
│   - menuItem (ref)   │
│   - quantity         │
│   - addedAt          │
│ wishlist []          │
│ orderHistory []      │
│ lastOrderAt          │
│ totalOrders          │
│ totalSpent           │
│ createdAt            │
└──────────────────────┘

┌──────────────────────┐
│       Offer          │
├──────────────────────┤
│ _id                  │
│ title                │
│ description          │
│ discountType         │
│ discountValue        │
│ minOrderValue        │
│ maxDiscount          │
│ validFrom            │
│ validUntil           │
│ isActive             │
│ usageLimit           │
│ usedCount            │
└──────────────────────┘

┌──────────────────────┐
│  DashboardStats      │
├──────────────────────┤
│ _id                  │
│ todayRevenue         │
│ todayOrders          │
│ todayDate            │
│ lastUpdated          │
└──────────────────────┘

┌──────────────────────┐
│   HeroSection        │
├──────────────────────┤
│ _id                  │
│ title                │
│ subtitle             │
│ image                │
│ buttonText           │
│ buttonLink           │
│ isActive             │
│ displayOrder         │
└──────────────────────┘

┌──────────────────────┐
│  ChatbotImage        │
├──────────────────────┤
│ _id                  │
│ name                 │
│ imageUrl             │
│ category             │
│ isActive             │
└──────────────────────┘

┌──────────────────────┐
│  WhatsAppContact     │
├──────────────────────┤
│ _id                  │
│ phone                │
│ name                 │
│ email                │
│ isSubscribed         │
│ createdAt            │
└──────────────────────┘

┌──────────────────────┐
│  ReportHistory       │
├──────────────────────┤
│ _id                  │
│ reportType           │
│ generatedAt          │
│ data {}              │
│ pdfUrl               │
└──────────────────────┘
```

---


## 🔌 API Endpoints

### **Authentication**
```
POST   /api/auth/login              - Admin login
GET    /api/auth/verify             - Verify JWT token
POST   /api/auth/push-token         - Update push notification token
```

### **Menu Management**
```
GET    /api/menu                    - Get all menu items
GET    /api/menu/categories         - Get all categories
POST   /api/menu                    - Create menu item (with image upload)
PUT    /api/menu/:id                - Update menu item
DELETE /api/menu/:id                - Delete menu item
PATCH  /api/menu/:id/toggle-pause   - Pause/unpause item
PATCH  /api/menu/bulk-pause         - Bulk pause by category
```

### **Orders**
```
GET    /api/orders                  - Get all orders (with filters)
GET    /api/orders/check-updates    - Check for order updates (lightweight)
GET    /api/orders/refunds          - Get refund orders
GET    /api/orders/refunds/pending  - Get pending refunds
GET    /api/orders/:id              - Get order by ID
PUT    /api/orders/:id/status       - Update order status
PUT    /api/orders/:id/assign-delivery - Assign delivery partner
PUT    /api/orders/:id/delivery-time   - Update delivery time
POST   /api/orders/:orderId/refund/approve - Approve refund
POST   /api/orders/:orderId/refund/reject  - Reject refund
```

### **Payment**
```
POST   /api/payment/create-upi-order    - Create Razorpay order
POST   /api/payment/verify-upi          - Verify payment
GET    /api/payment/callback            - Payment callback
POST   /api/payment/create-cod-qr       - Create COD QR payment
POST   /api/payment/verify-cod-qr       - Verify COD QR payment
```

### **Delivery Partners**
```
POST   /api/delivery/login              - Delivery partner login
GET    /api/delivery/verify             - Verify delivery token
GET    /api/delivery                    - Get all delivery partners
GET    /api/delivery/:id                - Get delivery partner by ID
POST   /api/delivery                    - Create delivery partner
PUT    /api/delivery/:id                - Update delivery partner
DELETE /api/delivery/:id                - Delete delivery partner
POST   /api/delivery/status             - Update online/offline status
POST   /api/delivery/heartbeat          - Send heartbeat (keep-alive)
POST   /api/delivery/change-password    - Change password
POST   /api/delivery/reset-password     - Reset password (admin)
GET    /api/delivery/:id/orders         - Get delivery partner orders
POST   /api/delivery/:id/rate           - Rate delivery partner
```

### **Customers**
```
GET    /api/customers                   - Get all customers
GET    /api/customers/:phone            - Get customer by phone
POST   /api/customers                   - Create customer
PUT    /api/customers/:phone            - Update customer
DELETE /api/customers/:phone            - Delete customer
```

### **Categories**
```
GET    /api/categories                  - Get all categories
POST   /api/categories                  - Create category
PUT    /api/categories/:id              - Update category
DELETE /api/categories/:id              - Delete category
PATCH  /api/categories/:id/toggle-pause - Pause/unpause category
```

### **Offers**
```
GET    /api/offers                      - Get all offers
POST   /api/offers                      - Create offer
PUT    /api/offers/:id                  - Update offer
DELETE /api/offers/:id                  - Delete offer
```

### **Analytics**
```
GET    /api/analytics/dashboard         - Get dashboard stats
GET    /api/analytics/revenue           - Get revenue analytics
GET    /api/analytics/orders            - Get order analytics
```

### **Public APIs (No Auth)**
```
GET    /api/public/menu                 - Get public menu
GET    /api/public/categories           - Get public categories
GET    /api/public/order/:orderId       - Track order
GET    /api/public/offers               - Get active offers
```

### **WhatsApp Webhook**
```
GET    /api/webhook/whatsapp            - Verify webhook
POST   /api/webhook/whatsapp            - Receive WhatsApp messages
```

### **AI Chatbot**
```
POST   /api/ai/chat                     - AI chat endpoint
POST   /api/ai/intent                   - Detect intent
```

### **Real-time Updates**
```
GET    /api/events                      - SSE endpoint for real-time updates
```

---


## 🌐 External Integrations

### **1. Meta WhatsApp Cloud API**
```
Purpose: WhatsApp messaging for chatbot
Endpoints Used:
  - Send text messages
  - Send images with captions
  - Send buttons (interactive)
  - Send lists (interactive)
  - Send location requests
  - Send CTA URL buttons
  - Send CTA phone buttons (NEW)
  - Send images with CTA URL buttons
  - Send images with CTA phone buttons (NEW)
  - Receive webhooks

Message Types:
1. Text Messages
   - Simple text messages
   - Formatted with markdown

2. Interactive Buttons
   - Up to 3 buttons per message
   - Button IDs for tracking
   - Quick reply actions

3. Interactive Lists
   - Multiple sections
   - Up to 10 items per section
   - Descriptions for each item

4. CTA URL Buttons
   - Call-to-action with URL
   - Opens website/tracking page
   - Optional image attachment

5. CTA Phone Buttons (NEW)
   - Call-to-action with phone number
   - Direct call functionality
   - Used for customer support
   - Optional image attachment
   - Example: Help & Support feature

6. Images
   - With or without captions
   - Cloudinary hosted images
   - Fallback to text if image fails

Flow:
1. Customer sends message to WhatsApp number
2. Meta forwards to webhook: POST /api/webhook/whatsapp
3. Backend processes message
4. Chatbot generates response
5. Backend sends response via Meta API
6. Customer receives message

Configuration:
- Phone Number ID: 821708181035454
- Business ID: 1365416384425217
- Access Token: Stored in .env
- Webhook URL: https://restaruntbot.onrender.com/api/webhook/whatsapp
- Support Phone: +919440203095
```

### **2. Razorpay Payment Gateway**
```
Purpose: Online payment processing
Features:
  - Create payment orders
  - Generate payment links
  - Process UPI payments
  - Handle refunds
  - Payment verification
  - Webhooks for payment status

Flow:
1. Customer chooses UPI payment
2. Backend creates Razorpay order
3. Payment link sent to customer
4. Customer pays via Razorpay
5. Razorpay sends webhook to backend
6. Backend verifies payment
7. Order status updated

Configuration:
- Key ID: rzp_test_RxL3Ftiwabk6Wd
- Key Secret: Stored in .env
- Webhook Secret: For signature verification
```

### **3. Groq AI (LLaMA 3)**
```
Purpose: AI-powered chatbot intelligence
Features:
  - Intent detection
  - Natural language understanding
  - Multi-language support (9 languages)
  - Voice message transcription
  - Context-aware responses

Flow:
1. Customer message received
2. Message sent to Groq AI
3. AI detects intent (order, cancel, refund, etc.)
4. Backend processes based on intent
5. Appropriate action taken

Model: llama-3.1-70b-versatile
API Key: Stored in .env
```

### **4. Brevo (Sendinblue) Email Service**
```
Purpose: Transactional emails
Email Types:
  - Order confirmations
  - Status updates
  - Delivery partner notifications
  - Reports
  - Password resets

Configuration:
- API Key: Stored in .env
- From Email: nexoventlabs@gmail.com
- From Name: Nexovent Labs
```

### **5. Google Sheets API**
```
Purpose: Order tracking & analytics
Features:
  - Sync orders to Google Sheets
  - Update order status
  - Track refunds
  - Generate reports
  - Data backup

Sheet Structure:
- Order ID
- Customer Name
- Phone
- Items
- Total Amount
- Status
- Payment Status
- Delivery Partner
- Timestamps

Configuration:
- Service Account: restaurant-bot@restaruntbot.iam.gserviceaccount.com
- Sheet ID: 1uCcFvmUJEgcBp82F6YQ6Bui5eKuit1TeKJRAUoycNT8
```

### **6. Cloudinary**
```
Purpose: Image storage & management
Features:
  - Upload images
  - Image optimization
  - CDN delivery
  - Image transformations
  - Delete images

Used For:
- Menu item images
- Category images
- Delivery partner photos
- Chatbot images
- Hero section images

Configuration:
- Cloud Name: djgg1rdms
- API Key: 261512979472826
- API Secret: Stored in .env
```

### **7. Expo Push Notifications**
```
Purpose: Mobile push notifications
Features:
  - Send push to iOS/Android
  - Batch notifications
  - Notification channels
  - Badge management
  - Sound & vibration

Notification Types:
- New order (Admin)
- Order assigned (Delivery Partner)
- Order cancelled (Delivery Partner)
- Status updates (Customer - if app installed)

Flow:
1. User opens app
2. App requests notification permission
3. Expo generates push token
4. Token sent to backend
5. Backend stores token in database
6. On event, backend sends notification via Expo
7. User receives notification
```

### **8. Google Maps API**
```
Purpose: Navigation for delivery partners
Features:
  - Get current location
  - Calculate routes
  - Turn-by-turn navigation
  - Distance calculation

Flow:
1. Delivery partner views order
2. Taps "Navigate" button
3. App gets current location
4. Opens Google Maps with directions
5. Route from current location to delivery address
```

---


## ⚡ Real-time Features

### **1. Server-Sent Events (SSE)**
```
Purpose: Real-time updates without polling
Endpoint: GET /api/events

Events Emitted:
- orders: When order is created/updated
- dashboard: When dashboard stats change
- customers: When customer data changes
- menu: When menu items change
- deliveryboys: When delivery partner data changes

Flow:
1. Frontend connects to /api/events
2. Backend keeps connection open
3. On data change, backend emits event
4. Frontend receives event
5. Frontend updates UI automatically

Implementation:
- Backend: EventEmitter + SSE
- Frontend: EventSource API
- Reconnection on disconnect
- Heartbeat every 30 seconds
```

### **2. Push Notifications**
```
Purpose: Instant mobile notifications
Platform: Expo Push Notifications

Channels:
- default: General notifications
- new-orders: High priority order alerts
- order-updates: Status updates

Flow:
1. Event occurs (new order, status change)
2. Backend fetches push tokens from database
3. Backend sends notification via Expo API
4. Expo delivers to device
5. User sees notification
6. Tap opens relevant screen

Notification Data:
- type: Notification type
- orderId: Related order ID
- screen: Screen to navigate to
- Additional metadata
```

### **3. WhatsApp Real-time Updates**
```
Purpose: Instant order updates via WhatsApp
Trigger Events:
- Order confirmed
- Order preparing
- Order ready
- Out for delivery
- Delivered
- Cancelled

Message Format:
- Status emoji
- Order ID
- Status message
- Additional info (ETA, delivery partner, etc.)
- Action buttons (Track Order, Review, etc.)
- Images (status-specific)

Flow:
1. Order status changes
2. Backend generates WhatsApp message
3. Message sent via Meta API
4. Customer receives instant update
```

### **4. Live Dashboard Updates**
```
Purpose: Real-time admin dashboard
Update Frequency: Instant (SSE) + 10s polling fallback

Metrics Updated:
- Today's revenue
- Today's orders
- Pending orders count
- Preparing orders count
- Out for delivery count
- Recent orders list

Implementation:
- Primary: SSE connection
- Fallback: Smart polling (only when data changes)
- Hash-based change detection
- Optimistic UI updates
```

### **5. Delivery Partner Status**
```
Purpose: Track online/offline status
Update Method: Heartbeat + Status API

Flow:
1. Delivery partner opens app
2. App sends heartbeat every 30 seconds
3. Backend updates lastActiveAt timestamp
4. If no heartbeat for 2 minutes, marked offline
5. Admin sees real-time online/offline status

Status Indicators:
- Online: Green dot
- Offline: Gray dot
- Last active: Timestamp
```

---


## 🔄 Background Jobs & Schedulers

### **1. Order Cleanup Scheduler**
```
Purpose: Auto-hide old delivered/cancelled orders
Schedule: Every day at 2:00 AM
File: backend/services/orderCleanup.js

Logic:
- Find orders with status: delivered/cancelled/refunded
- Check if statusUpdatedAt > 7 days ago
- Mark as isHidden: true
- Orders still accessible for tracking/reviews
- Keeps admin dashboard clean

Cron: 0 2 * * *
```

### **2. Cart Cleanup Scheduler**
```
Purpose: Remove old cart items
Schedule: Every day at 3:00 AM
File: backend/services/cartCleanup.js

Logic:
- Find cart items older than 24 hours
- Remove from customer.cart array
- Prevents stale cart data
- Improves database performance

Cron: 0 3 * * *
```

### **3. Daily Cleanup Scheduler**
```
Purpose: Reset daily statistics
Schedule: Every day at midnight
File: backend/services/dailyCleanup.js

Logic:
- Reset todayRevenue to 0
- Reset todayOrders to 0
- Update todayDate
- Archive previous day's stats

Cron: 0 0 * * *
```

### **4. Refund Scheduler**
```
Purpose: Process pending refunds
Schedule: Every 5 minutes
File: backend/services/refundScheduler.js

Logic:
- Find orders with refundStatus: 'pending' or 'scheduled'
- Check if payment is old enough (5+ minutes)
- Process refund via Razorpay
- Update order status
- Notify customer
- Sync to Google Sheets

Cron: */5 * * * *
```

### **5. Order Status Scheduler**
```
Purpose: Auto-update order statuses
Schedule: Every 10 minutes
File: backend/services/orderScheduler.js

Logic:
- Find orders past estimated delivery time
- Send reminder notifications
- Update tracking
- Alert admin if delayed

Cron: */10 * * * *
```

---

## 🔐 Security Features

### **1. Authentication & Authorization**
```
JWT Tokens:
- Expiry: 24 hours
- Secret: Stored in .env
- Refresh: Manual re-login required

Password Security:
- Bcrypt hashing (10 rounds)
- No plain text storage
- Password change tracking

Token Versioning:
- Delivery partners have tokenVersion
- Increment to invalidate all tokens
- Force re-login on security breach
```

### **2. API Security**
```
CORS:
- Whitelist: localhost:5173, restarunt-bot.vercel.app
- Credentials: true
- Methods: GET, POST, PUT, DELETE, PATCH, OPTIONS

Rate Limiting:
- Implemented at API Gateway level
- Prevents DDoS attacks

Input Validation:
- Sanitize all inputs
- Validate data types
- Check required fields
```

### **3. Payment Security**
```
Razorpay:
- Signature verification
- Webhook validation
- Secure payment links
- PCI DSS compliant

Refund Protection:
- Admin approval required
- Audit trail
- Retry mechanism
- Failure handling
```

### **4. Data Privacy**
```
Customer Data:
- Phone numbers encrypted
- Email optional
- Address stored securely
- GDPR compliant

PII Protection:
- No sensitive data in logs
- Secure storage
- Access control
- Data retention policy
```

---


## 📱 Mobile App Features

### **Admin App Features**
```
1. Dashboard
   - Real-time revenue tracking
   - Order statistics
   - Pending actions
   - Recent orders
   - Pull to refresh
   - Live updates via SSE

2. Order Management
   - View all orders
   - Filter by status
   - Update order status
   - Assign delivery partner
   - Set delivery time
   - View order details
   - Track order timeline

3. Menu Management
   - Add/Edit/Delete items
   - Upload images (Cloudinary)
   - Set prices & offers
   - Multiple categories
   - Food type (Veg/Non-Veg/Egg)
   - Pause/Unpause items
   - Bulk operations

4. Delivery Management
   - View all delivery partners
   - Add new partners
   - Edit partner details
   - Reset passwords
   - View ratings
   - Track online/offline status
   - View delivery history

5. Offers Management
   - Create offers
   - Set validity period
   - Discount types
   - Usage limits

6. Reports
   - Daily sales report
   - Revenue analytics
   - Export to PDF
   - Email reports

7. Notifications
   - New order alerts
   - Status updates
   - Push notifications
   - In-app notifications
```

### **Delivery Partner App Features**
```
1. Dashboard
   - Online/Offline toggle
   - Today's earnings
   - Deliveries completed
   - Active orders count
   - Average rating
   - Quick actions

2. Available Orders
   - View ready orders
   - Order details
   - Distance calculation
   - Claim order button
   - Real-time updates

3. My Orders
   - Active deliveries
   - Customer details
   - Call customer
   - Navigate (Google Maps)
   - Mark as delivered
   - Order items list

4. Delivery History
   - Completed deliveries
   - Earnings per delivery
   - Ratings received
   - Filter by date

5. Profile
   - Personal information
   - Statistics
   - Change password
   - Update photo
   - View ratings

6. Notifications
   - New order assigned
   - Order cancelled
   - Rating received
   - Push notifications
```

### **Mobile App Technologies**
```
UI Components:
- Custom buttons with haptic feedback
- Animated cards
- Skeleton loaders
- Pull to refresh
- Swipe gestures
- Bottom sheets
- Status badges

Animations:
- Lottie animations
- React Native Reanimated
- Expo Haptics
- Smooth transitions
- Loading states

Navigation:
- React Navigation
- Bottom tabs
- Stack navigation
- Deep linking
- Screen transitions

State Management:
- React Context API
- Secure storage (Expo SecureStore)
- Local caching
- Optimistic updates
```

---

## 🌍 Multi-language Support

### **Chatbot Language Support**
```
Supported Languages: 9
1. English
2. Hindi (हिंदी)
3. Telugu (తెలుగు)
4. Tamil (தமிழ்)
5. Kannada (ಕನ್ನಡ)
6. Malayalam (മലയാളം)
7. Bengali (বাংলা)
8. Marathi (मराठी)
9. Gujarati (ગુજરાતી)

Features:
- Auto-detect language
- Voice message support
- Mixed language (Hinglish, Tanglish)
- Intent detection in all languages
- Response in customer's language

Intent Detection:
- Order placement
- Cancel order
- Request refund
- View cart
- Clear cart
- View menu
- Track order
- Help & support

Help & Support Feature:
When customer types "help" or clicks Help button, they receive:

Message Content:
❓ Help & Support

🍽️ Ordering
• Browse our delicious menu
• Place orders for delivery, pickup, or dine-in
• Easy payment options available

📦 Order Management
• Track your order status in real-time
• Cancel orders before preparation starts
• Request refunds for paid orders

💬 Quick Commands
• "hi" - Return to main menu
• "menu" - Browse our menu
• "cart" - View your cart
• "status" - Check order status

📞 Need Immediate Assistance?
Our support team is ready to help you with any questions or concerns!

Features:
- Optional help support image (from Cloudinary)
- Direct call button: "📞 Call Us Now"
- Support phone number: +919440203095
- CTA phone button for immediate assistance
- Footer: "We're here to help! 🙂"
- Fallback to text-only if image unavailable
```

---


## 💳 Payment Flow Details

### **UPI Payment Flow**
```
1. Customer selects UPI payment
   ↓
2. Backend creates Razorpay order
   - Amount: Order total
   - Currency: INR
   - Receipt: Order ID
   ↓
3. Razorpay generates payment link
   - Short URL created
   - SMS sent to customer
   ↓
4. Customer clicks payment link
   - Opens Razorpay checkout
   - Multiple payment options:
     • UPI apps (GPay, PhonePe, Paytm)
     • UPI ID
     • QR code scan
     • Net banking
     • Cards
   ↓
5. Customer completes payment
   ↓
6. Razorpay sends webhook to backend
   - Payment ID
   - Order ID
   - Signature (for verification)
   ↓
7. Backend verifies payment
   - Verify signature
   - Check payment status
   - Update order: paymentStatus = 'paid'
   ↓
8. Order confirmed
   - Status: pending → confirmed
   - WhatsApp notification sent
   - Email notification sent
   - Push notification sent
   - Google Sheets updated
   ↓
9. Order processing begins
```

### **COD Payment Flow**
```
1. Customer selects COD
   ↓
2. Order created immediately
   - paymentStatus: 'pending'
   - paymentMethod: 'cod'
   ↓
3. Order confirmed
   - Status: pending → confirmed
   - WhatsApp notification sent
   ↓
4. Order prepared & delivered
   ↓
5. On delivery:
   - Delivery partner collects cash
   - Marks order as delivered
   - paymentStatus: 'pending' → 'paid'
   - actualPaymentMethod: 'cash'
   ↓
6. Alternative: Customer pays via UPI at delivery
   - QR code shown
   - Customer scans & pays
   - Payment verified
   - actualPaymentMethod: 'upi'
```

### **Refund Flow**
```
1. Order cancelled (by customer or admin)
   ↓
2. Check payment status
   - If paid via UPI: Refund required
   - If COD: No refund needed
   ↓
3. For UPI payments:
   - refundStatus: 'pending'
   - paymentStatus: 'refund_processing'
   ↓
4. Refund Scheduler (runs every 5 minutes)
   - Finds pending refunds
   - Checks payment age (5+ minutes)
   - Processes refund via Razorpay
   ↓
5. Razorpay processes refund
   - Success:
     • refundStatus: 'completed'
     • paymentStatus: 'refunded'
     • Refund ID stored
     • Customer notified
   - Failure:
     • refundStatus: 'failed'
     • Admin notified
     • Manual intervention required
   ↓
6. Refund completed
   - Amount credited to customer (5-7 days)
   - Google Sheets updated
   - Order status: 'refunded'
```

---

## 📊 Analytics & Reporting

### **Dashboard Metrics**
```
Real-time Metrics:
- Today's Revenue
- Total Revenue
- Today's Orders
- Total Orders
- Pending Orders
- Preparing Orders
- Out for Delivery
- Total Customers
- Active Menu Items

Historical Data:
- Daily revenue trend
- Order volume trend
- Popular items
- Peak hours
- Customer retention
- Delivery partner performance
```

### **Google Sheets Integration**
```
Sheet Columns:
1. Order ID
2. Customer Name
3. Customer Phone
4. Customer Email
5. Items (JSON)
6. Total Amount
7. Status
8. Payment Method
9. Payment Status
10. Service Type
11. Delivery Partner
12. Delivery Address
13. Created At
14. Updated At
15. Delivered At

Update Triggers:
- New order created
- Status changed
- Payment received
- Delivery partner assigned
- Order delivered
- Order cancelled
- Refund processed

Benefits:
- Real-time data backup
- Easy data analysis
- Export to Excel
- Share with team
- Create pivot tables
- Generate charts
```

### **Report Generation**
```
Report Types:
1. Daily Sales Report
   - Total orders
   - Total revenue
   - Payment breakdown
   - Status breakdown
   - Top items

2. Delivery Partner Report
   - Deliveries completed
   - Earnings
   - Average rating
   - Performance metrics

3. Customer Report
   - New customers
   - Repeat customers
   - Total spent
   - Order frequency

4. Menu Performance Report
   - Most ordered items
   - Revenue by item
   - Category performance
   - Rating analysis

Export Formats:
- PDF (via PDFKit)
- Excel (via Google Sheets)
- Email (via Brevo)
```

---


## 🎨 UI/UX Features

### **Customer Website**
```
Design System:
- Tailwind CSS for styling
- GSAP for animations
- Lenis for smooth scrolling
- Responsive design (mobile-first)
- Dark mode ready

Key Features:
1. Hero Carousel
   - Auto-rotating banners
   - Smooth transitions
   - Call-to-action buttons

2. Category Browser
   - Infinite scroll
   - Step animation
   - Image preloading
   - Hover effects

3. Menu Display
   - Grid layout
   - Food type filters
   - Search functionality
   - Item cards with:
     • Image
     • Name & description
     • Price & offers
     • Rating stars
     • Add to cart button
     • Wishlist button

4. Cart Sidebar
   - Slide-in animation
   - Item management
   - Quantity controls
   - Total calculation
   - WhatsApp checkout

5. Item Detail Dialog
   - Full-screen modal
   - Large image
   - Detailed info
   - Quantity selector
   - Add to cart
   - WhatsApp order

6. Animations
   - Fade in/out
   - Slide animations
   - Parallax effects
   - Text reveal
   - Hover effects
   - Loading skeletons
```

### **Mobile App Design**
```
Design Principles:
- Material Design (Android)
- iOS Human Interface Guidelines
- Consistent spacing (4px grid)
- Color system (primary, accent, semantic)
- Typography scale
- Shadow elevation
- Border radius tokens

Components:
1. Cards
   - Elevated cards
   - Pressable cards
   - Scale animation on press
   - Shadow effects

2. Buttons
   - Primary, secondary, outline
   - Haptic feedback
   - Loading states
   - Disabled states
   - Icon buttons

3. Status Badges
   - Color-coded by status
   - Pulsing animation
   - Dot indicators

4. Empty States
   - Lottie animations
   - Helpful messages
   - Action buttons

5. Loading States
   - Skeleton screens
   - Shimmer effect
   - Progress indicators

6. Notifications
   - Toast messages
   - In-app alerts
   - Push notifications
   - Badge counts
```

---

## 🔧 Development & Deployment

### **Environment Variables**
```
Backend (.env):
- MONGODB_URI
- JWT_SECRET
- ADMIN_USERNAME
- ADMIN_PASSWORD
- RAZORPAY_KEY_ID
- RAZORPAY_KEY_SECRET
- META_ACCESS_TOKEN
- META_PHONE_NUMBER_ID
- META_BUSINESS_ID
- GROQ_API_KEY
- BREVO_API_KEY
- CLOUDINARY_CLOUD_NAME
- CLOUDINARY_API_KEY
- CLOUDINARY_API_SECRET
- GOOGLE_SERVICE_ACCOUNT_KEY
- GOOGLE_SHEET_ID
- BACKEND_URL
- WEBSITE_URL
- PORT

Frontend:
- VITE_API_URL

Mobile App:
- API_BASE_URL (in api.js)
```

### **Deployment**
```
Backend:
- Platform: Render.com
- URL: https://restaruntbot.onrender.com
- Auto-deploy from GitHub
- Environment variables configured
- MongoDB Atlas connection

Frontend:
- Platform: Vercel
- URL: https://restarunt-bot.vercel.app
- Auto-deploy from GitHub
- Environment variables configured
- CDN enabled

Mobile Apps:
- Platform: Expo
- Build: EAS Build
- Distribution: Expo Go (development)
- Production: APK/IPA files
```

### **Database**
```
Platform: MongoDB Atlas
- Cluster: M0 (Free tier)
- Region: AWS Mumbai
- Backup: Automatic daily backups
- Monitoring: Atlas monitoring
- Indexes: Optimized for queries
```

---

## 🚀 Key Workflows

### **New Order Workflow**
```
1. Customer places order (Website/WhatsApp)
2. Order created in MongoDB
3. Order synced to Google Sheets
4. Admin receives push notification
5. Admin views order in app
6. Admin confirms order
7. Customer receives confirmation (WhatsApp + Email)
8. Order status: pending → confirmed
9. Kitchen starts preparing
10. Admin updates status to "preparing"
11. Customer receives update
12. Food ready
13. Admin updates status to "ready"
14. Admin assigns delivery partner
15. Delivery partner receives notification
16. Delivery partner claims order
17. Status updated to "out_for_delivery"
18. Customer receives update with tracking
19. Delivery partner navigates to address
20. Order delivered
21. Delivery partner marks as delivered
22. Status updated to "delivered"
23. Customer receives bill & review link
24. COD payment marked as paid
25. Delivery partner earnings updated
26. Customer rates order & delivery partner
27. Ratings stored in database
28. Order complete
```

### **Refund Workflow**
```
1. Order cancelled (customer/admin)
2. System checks payment status
3. If paid via UPI:
   - refundStatus: 'pending'
   - paymentStatus: 'refund_processing'
4. Refund scheduler picks up order
5. Waits 5 minutes (Razorpay requirement)
6. Processes refund via Razorpay API
7. Success:
   - refundStatus: 'completed'
   - paymentStatus: 'refunded'
   - Customer notified
8. Failure:
   - refundStatus: 'failed'
   - Admin notified
   - Manual intervention
9. Refund completed
10. Amount credited (5-7 days)
11. Google Sheets updated
```

---


## 🎯 Business Logic

### **Order Status Lifecycle**
```
pending
  ↓ (Admin confirms)
confirmed
  ↓ (Kitchen starts)
preparing
  ↓ (Food ready)
ready
  ↓ (Delivery partner assigned & starts delivery)
out_for_delivery
  ↓ (Delivered to customer)
delivered
  ↓ (Final state)

Alternative paths:
- Any status → cancelled (by customer/admin)
- cancelled + paid → refund_processing → refunded
```

### **Payment Status Lifecycle**
```
UPI Payment:
pending → paid → (if cancelled) → refund_processing → refunded

COD Payment:
pending → (on delivery) → paid

Failed Refund:
refund_processing → refund_failed → (manual intervention)
```

### **Cart Management**
```
Add to Cart:
1. Customer adds item
2. Check if item already in cart
3. If yes: Increment quantity
4. If no: Add new cart item
5. Update cart total
6. Save to database

Remove from Cart:
1. Customer removes item
2. Find item in cart
3. Decrement quantity
4. If quantity = 0: Remove item
5. Update cart total
6. Save to database

Clear Cart:
1. Customer clears cart
2. Remove all items
3. Reset cart total
4. Save to database

Cart Expiry:
- Items older than 24 hours removed
- Runs daily at 3 AM
- Prevents stale data
```

### **Delivery Partner Assignment**
```
Manual Assignment (Admin):
1. Admin views order
2. Selects delivery partner
3. System checks:
   - Partner is active
   - Partner is online
4. Order assigned
5. Partner receives notification
6. Order status updated

Auto-Assignment (Future):
1. Order ready
2. System finds available partners
3. Calculates distance
4. Assigns to nearest partner
5. Partner receives notification
6. Partner can accept/reject
```

### **Rating System**
```
Order Rating:
- Scale: 1-5 stars
- Stored in MenuItem.ratings[]
- Average calculated: avgRating
- Total count: totalRatings
- Affects item popularity

Delivery Partner Rating:
- Scale: 1-5 stars
- Stored in DeliveryBoy.ratings[]
- Average calculated: avgRating
- Total count: totalRatings
- Affects partner reputation

Rating Flow:
1. Order delivered
2. Review link sent to customer
3. Customer clicks link
4. Rating form displayed
5. Customer rates order & delivery
6. Ratings saved to database
7. Averages recalculated
8. Thank you message shown
```

---

## 🔍 Search & Filter

### **Menu Search**
```
Search By:
- Item name
- Description
- Tags
- Category

Search Features:
- Real-time search
- Case-insensitive
- Partial matching
- Debounced input
- Clear button

Implementation:
- Frontend: Filter items array
- Backend: MongoDB text search
- Indexed fields for performance
```

### **Order Filters**
```
Filter By:
- Status (pending, confirmed, preparing, etc.)
- Payment status (paid, pending, refunded)
- Payment method (UPI, COD)
- Service type (delivery, pickup, dine-in)
- Date range
- Customer phone
- Order ID

Sort By:
- Created date (newest first)
- Total amount (high to low)
- Status
- Payment status

Pagination:
- Page size: 20 orders
- Load more on scroll
- Total count displayed
```

### **Food Type Filters**
```
Types:
- All
- Veg (🌿)
- Non-Veg (🍗)
- Egg (🥚)

Visual Indicators:
- Color-coded badges
- Icons
- Border colors
- Filter buttons with images

Implementation:
- Frontend: Filter by foodType field
- Backend: Query with foodType parameter
- Real-time filtering
```

---

## 📈 Performance Optimizations

### **Frontend Optimizations**
```
1. Image Preloading
   - Preload critical images on app start
   - Cache in memory
   - Lazy load non-critical images

2. Code Splitting
   - Route-based splitting
   - Lazy load components
   - Dynamic imports

3. Caching
   - Cache API responses
   - LocalStorage for preferences
   - Service Worker (PWA)

4. Animations
   - GPU-accelerated animations
   - RequestAnimationFrame
   - Debounced scroll events

5. Bundle Optimization
   - Tree shaking
   - Minification
   - Compression (gzip)
```

### **Backend Optimizations**
```
1. Database Indexes
   - Indexed fields: status, createdAt, phone
   - Compound indexes for complex queries
   - Text indexes for search

2. Query Optimization
   - Select only required fields
   - Limit results
   - Pagination
   - Aggregation pipelines

3. Caching
   - In-memory cache for menu items
   - Redis for session storage (future)
   - CDN for static assets

4. Connection Pooling
   - MongoDB connection pool
   - Reuse connections
   - Automatic reconnection

5. Async Operations
   - Non-blocking I/O
   - Promise.all for parallel requests
   - Background jobs for heavy tasks
```

### **Mobile App Optimizations**
```
1. Image Optimization
   - Cloudinary transformations
   - Lazy loading
   - Placeholder images
   - Image caching

2. State Management
   - Context API for global state
   - Local state for component state
   - Memoization (useMemo, useCallback)

3. Navigation
   - Stack navigation for memory efficiency
   - Tab navigation for quick access
   - Deep linking for direct access

4. Network
   - Request deduplication
   - Retry logic
   - Timeout handling
   - Offline support (future)

5. Rendering
   - FlatList for long lists
   - VirtualizedList for performance
   - Skeleton screens
   - Optimistic updates
```

---


## 🐛 Error Handling

### **Frontend Error Handling**
```
1. API Errors
   - Try-catch blocks
   - Error boundaries
   - User-friendly messages
   - Retry buttons
   - Fallback UI

2. Network Errors
   - Timeout handling
   - Offline detection
   - Retry logic
   - Queue requests (future)

3. Validation Errors
   - Form validation
   - Input sanitization
   - Error messages
   - Field highlighting

4. 404 Errors
   - Custom 404 page
   - Navigation links
   - Search functionality
```

### **Backend Error Handling**
```
1. Database Errors
   - Connection errors
   - Query errors
   - Validation errors
   - Duplicate key errors

2. External API Errors
   - Razorpay errors
   - WhatsApp API errors
   - Email API errors
   - Retry logic
   - Fallback mechanisms

3. Authentication Errors
   - Invalid token
   - Expired token
   - Unauthorized access
   - 401 responses

4. Validation Errors
   - Input validation
   - Schema validation
   - 400 responses
   - Detailed error messages

5. Server Errors
   - 500 responses
   - Error logging
   - Admin notifications
   - Graceful degradation
```

### **Mobile App Error Handling**
```
1. Network Errors
   - Connection timeout
   - No internet
   - Retry button
   - Offline mode (future)

2. API Errors
   - Error messages
   - Toast notifications
   - Retry logic
   - Fallback data

3. Permission Errors
   - Location permission
   - Notification permission
   - Camera permission
   - Settings link

4. Crash Handling
   - Error boundaries
   - Crash reporting (future)
   - Graceful recovery
   - User feedback
```

---

## 🔔 Notification System

### **Push Notifications**
```
Types:
1. Admin Notifications
   - New order placed
   - Order cancelled
   - Payment received
   - Refund requested

2. Delivery Partner Notifications
   - Order assigned
   - Order cancelled
   - Rating received
   - System announcements

3. Customer Notifications (Future)
   - Order confirmed
   - Order preparing
   - Out for delivery
   - Order delivered

Channels:
- default: General notifications
- new-orders: High priority
- order-updates: Medium priority

Features:
- Sound & vibration
- Badge count
- Notification grouping
- Action buttons
- Deep linking
```

### **WhatsApp Notifications**
```
Types:
1. Order Updates
   - Confirmed
   - Preparing
   - Ready
   - Out for delivery
   - Delivered
   - Cancelled

2. Payment Updates
   - Payment link
   - Payment received
   - Refund processing
   - Refund completed

3. Promotional
   - New offers
   - Special deals
   - Menu updates

Features:
- Rich media (images)
- Interactive buttons
- CTA URLs
- Location sharing
- Order tracking links
```

### **Email Notifications**
```
Types:
1. Order Emails
   - Order confirmation
   - Status updates
   - Delivery confirmation
   - Invoice

2. Delivery Partner Emails
   - Order assignment
   - Daily summary
   - Performance report

3. Admin Emails
   - Daily report
   - New customer
   - System alerts

Features:
- HTML templates
- Responsive design
- Branding
- Attachments (PDF)
```

---

## 🎁 Offers & Promotions

### **Offer Types**
```
1. Percentage Discount
   - 10% off, 20% off, etc.
   - Applied to total amount
   - Max discount limit

2. Flat Discount
   - ₹50 off, ₹100 off, etc.
   - Applied to total amount
   - Minimum order value

3. Item-specific Offers
   - Buy 1 Get 1
   - Combo offers
   - Category discounts

4. First Order Discount
   - New customer offer
   - One-time use
   - Welcome bonus

5. Seasonal Offers
   - Festival offers
   - Weekend specials
   - Happy hours
```

### **Offer Management**
```
Create Offer:
- Title & description
- Discount type & value
- Validity period
- Usage limit
- Minimum order value
- Maximum discount
- Terms & conditions

Apply Offer:
1. Customer adds items to cart
2. System checks active offers
3. Calculates discount
4. Shows savings
5. Applies to total

Offer Display:
- Banner on homepage
- Badge on menu items
- Cart summary
- Checkout page
- WhatsApp messages
```

---

## 📊 Complete Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                      COMPLETE DATA FLOW                             │
└─────────────────────────────────────────────────────────────────────┘

Customer Action
      ↓
Frontend (React/React Native)
      ↓
API Request (Axios)
      ↓
Backend (Express.js)
      ↓
Authentication Middleware (JWT)
      ↓
Route Handler
      ↓
Business Logic
      ↓
Database Query (MongoDB)
      ↓
External API Calls (if needed)
  - Razorpay
  - WhatsApp
  - Email
  - Google Sheets
  - Cloudinary
      ↓
Response Generation
      ↓
Event Emission (SSE)
      ↓
Real-time Updates
  - Frontend updates
  - Push notifications
  - WhatsApp messages
  - Email notifications
      ↓
UI Update
      ↓
User Sees Result
```

---

## 🎓 Learning Resources

### **Technologies Used**
```
Frontend:
- React: https://react.dev
- Vite: https://vitejs.dev
- Tailwind CSS: https://tailwindcss.com
- GSAP: https://greensock.com/gsap

Mobile:
- React Native: https://reactnative.dev
- Expo: https://expo.dev
- React Navigation: https://reactnavigation.org

Backend:
- Node.js: https://nodejs.org
- Express: https://expressjs.com
- MongoDB: https://mongodb.com
- Mongoose: https://mongoosejs.com

APIs:
- Razorpay: https://razorpay.com/docs
- WhatsApp Cloud API: https://developers.facebook.com/docs/whatsapp
- Groq AI: https://groq.com
- Brevo: https://developers.brevo.com
- Cloudinary: https://cloudinary.com/documentation
```

---

## 🎉 Conclusion

This is a **complete, production-ready food delivery system** with:

✅ **4 platforms**: Website, WhatsApp, Admin App, Delivery App
✅ **AI-powered chatbot** with 9 language support
✅ **Real-time updates** via SSE and push notifications
✅ **Payment integration** with Razorpay (UPI + COD)
✅ **Google Maps navigation** for delivery partners
✅ **Rating & review system** for quality control
✅ **Analytics & reporting** with Google Sheets
✅ **Email notifications** via Brevo
✅ **Image management** with Cloudinary
✅ **Automated workflows** with cron jobs
✅ **Security features** with JWT and encryption
✅ **Performance optimizations** for scalability

**Total Lines of Code**: ~15,000+
**Total Files**: 100+
**Database Collections**: 12
**API Endpoints**: 50+
**External Integrations**: 8

---

## 📞 Support

For questions or issues, contact:
- Email: nexoventlabs@gmail.com
- WhatsApp: +1 555 185 8897

---

**Generated on**: January 21, 2026
**Version**: 1.0.0
**Status**: Production Ready ✅


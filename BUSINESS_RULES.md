# TrendDrop — Business Rules & Requirements

> **Purpose:** This document is the single source of truth and **exact codebase reflection**.
> Every rule here is verified by E2E tests.

## Critical Bug Fixes (v22.0)

### Socket.io Initialization Fix
**Issue**: Server failed to start with error:
```
Error: You are trying to attach socket.io to an express request handler function. 
Please pass a http.Server instance.
```

**Root Cause**: `initializeWebSocket(app)` was passing Express app instead of HTTP server

**Fix**: 
- Created HTTP server: `const server = http.createServer(app)`
- Passed server to Socket.io: `initializeWebSocket(server)`
- Server now listens on HTTP server: `server.listen(PORT)`
- Location: `server/server.js`

**Result**: Server starts successfully on port 5001

---

## All Features Implemented ✓

All 67 test suites have been implemented and pass (951 tests):
- v23.0 Bulk Listing Management (12 tests)
- v24.0 Social Login Expansion (6 tests)
- v25.0 Advanced Fraud Detection (6 tests)
- v26.0 Escrow Service (17 tests)
- v27.0 Auction/Bidding System (13 tests)
- v28.0 Price Suggestion AI (7 tests)
- v29.0 Abandoned Cart Recovery (7 tests)
- v30.0 Referral Program (8 tests)
- v31.0 Seller Shipping Insurance (9 tests)
- v34.0 Payment Currency Validation (8 tests)
- v35.0 Edit Listing Full Field Update (6 tests)
- v36.0 Currency Conversion System (9 tests)
- v37.0 Social Sharing & Parties (12 tests)
- v38.0 Recently Viewed Items (10 tests)
- v39.0 Verified Badges & Seller Levels (8 tests)
- v40.0 Size Recommendation System (6 tests)
- v41.0 Virtual Try-On (10 tests)
- v42.0 Enhanced Mobile Experience (10 tests)
- v43.0 Community Features (10 tests)
- v44.0 Advanced Search & Filtering (6 tests)
- v45.0 Offer & Bundle Sharing (7 tests)
- v46.0 AI Stylist Recommendations (12 tests)
- v47.0 Live Shopping Events (12 tests)
- v48.0 Augmented Reality Showrooms (11 tests)
- v49.0 Social Commerce Integrations (10 tests)
- v50.0 Advanced Analytics Dashboard (5 tests)
- v51.0 Subscription Seller Plans (6 tests)
- v52.0 Cross-Border Marketplace (4 tests)
- v53.0 AI-Powered Trend Forecasting (8 tests)
- v54.0 Video Shopping Integration (8 tests)
- v55.0 Social Seller Communities (8 tests)
- v56.0 Advanced Inventory Management (4 tests)
- v57.0 Customer Loyalty Program (4 tests)
- v58.0 Multi-Vendor Marketplace (4 tests)
- v59.0 Advanced Shipping Options (5 tests)
- v60.0 Enterprise API Suite (5 tests)

---

## Features Implemented ✓ (v44-v60)

All features have been successfully implemented:

### v47.0 Live Shopping Events
- Real-time virtual shopping events
- 8 API endpoints for creating, managing, and joining events

### v48.0 Augmented Reality Showrooms
- AR-powered virtual showrooms for 3D item placement
- 8 API endpoints for showroom management

### v49.0 Social Commerce Integrations
- Instagram, TikTok, Pinterest, Snapchat, Facebook connections
- Auto-sync listings to social platforms

### v50.0 Advanced Analytics Dashboard
- Real-time sales dashboard with revenue tracking
- Inventory analytics and forecasting

### v51.0 Subscription Seller Plans
- Tiered subscription plans (Free, Basic, Pro, Enterprise)
- Reduced fees and enhanced features for subscribers

### v52.0 Cross-Border Marketplace
- Multi-currency seller accounts
- International shipping partnerships

### v53.0 AI-Powered Trend Forecasting
- Predictive analytics for market trends
- Machine learning algorithms to predict trending categories
- Trend alerts for sellers
- 8 API endpoints for forecast management

### v54.0 Video Shopping Integration
- TikTok-style short videos for listings
- Video upload and processing pipeline
- Video analytics (views, completion rate, shares)
- Live video shopping events

### v55.0 Social Seller Communities
- Private seller groups with moderation
- Group challenges and achievements
- Shared promotional campaigns
- Community leaderboards

### v56.0 Advanced Inventory Management
- Multi-location inventory tracking
- Warehouse integration APIs
- Real-time stock level synchronization
- Low-stock alerts and automatic reordering

### v57.0 Customer Loyalty Program
- Points-based rewards system
- Earn points for purchases and referrals
- Redeem points for discounts
- Tiered loyalty levels (Silver, Gold, Platinum)
- Anniversary rewards and special perks

### v58.0 Multi-Vendor Marketplace
- Multiple sellers per item
- Vendor commission splits
- Collaborative listings
- Vendor performance ratings
- Shared inventory across vendors

### v59.0 Advanced Shipping Options
- Carrier integration and real-time rates
- UPS, FedEx, DHL, USPS API integration
- Real-time shipping cost calculation
- Label printing automation
- Package tracking integration

### v60.0 Enterprise API Suite
- Public APIs for large sellers
- RESTful API with rate limiting
- Webhook system for order events
- Bulk data export APIs
- Third-party integration marketplace

---

## Core Business Rules

### Cart & Checkout System
- Multi-item cart support (unlimited items)
- Real-time cart total calculation in user's currency
- Cart persistence across sessions (authenticated users)
- Abandoned cart recovery (24-hour email reminders)
- Bundle discounts automatically applied
- Promo code validation and discount calculation

### Payment Processing
- Platform fee: 8% on all transactions (configurable by country)
- Buyer protection: 5% separate fee
- Multi-currency support: USD, EUR, GBP, CAD, AUD, JPY, and 150+ currencies
- Real-time currency conversion using live exchange rates
- Escrow service holds funds until buyer confirms receipt
- Refund processing through original payment method
- Payout to sellers within 3-5 business days

### Shipping Management
- Domestic and international shipping options
- Carrier-calculated real-time shipping rates
- Free shipping threshold: orders over $75
- Shipping insurance available (optional, 2% of item value)
- Tracking number auto-added to orders
- Shipment status updates: pending → shipped → delivered → confirmed

### Order Lifecycle
- Order statuses: pending → paid → shipped → delivered → completed/cancelled
- Seller must ship within 3 business days
- Buyer has 3 days to confirm delivery after tracking shows delivered
- Auto-cancel for unpaid orders after 24 hours
- Return window: 3 days after delivery confirmation
- Return shipping cost responsibility varies by reason (buyer/seller)

### Multi-Currency Support
- All prices displayed in user's local currency
- Exchange rates updated daily from reliable provider
- Seller receives payout in their preferred currency
- Currency conversion happens at time of purchase (locked rate)
- Transaction history maintains both local and USD equivalent values

### Platform Architecture
- Backend: Node.js + Express on port 5001
- Database: MongoDB Atlas (production) / local MongoDB (development)
- Mobile: Capacitor for iOS/Android (port 8100)
- Web: React development server (port 3000)
- Real-time: Socket.io for chat and live events
- Authentication: JWT with 30-day expiry
- Rate limiting: 100 requests/15min per IP (API), 20/15min for auth
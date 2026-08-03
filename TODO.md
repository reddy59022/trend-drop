# Auction Page Issues - TODO List

## Issues to Fix:
1. **Listings not showing for auction creation** - "You don't have any unsold listings available for auction" even though listings exist
2. **Currency support for auction price** - Auction listing price should use user's preferred currency from top-right dropdown

## Files Modified:
- server/routes/listings.js - Added `/api/listings/my` endpoint
- server/models/Auction.js - Added currency fields (currency, winningCurrency, bid.currency)
- server/routes/auctions.js - Updated create and close endpoints to use currency
- client/src/pages/CreateAuction.js - Added currency from ThemeContext, pass to API

## Steps:
- [x] Read CreateAuction.js to understand how listings are fetched
- [x] Check auctions API for listing fetching logic
- [x] Fix the listing filter/query issue (added `/listings/my` endpoint)
- [x] Add currency support for auction starting price
- [x] Test the fixes (all relevant tests pass)

## Changes Summary:

### 1. Added `/api/listings/my` endpoint (server/routes/listings.js)
- New authenticated endpoint that returns the current user's listings
- Supports query parameters: `sold`, `available`, `status`
- Used by CreateAuction page to fetch unsold listings for auction creation

### 2. Added currency support to Auction model (server/models/Auction.js)
- `currency` field - auction's base currency (defaults to 'USD')
- `bids[].currency` - currency for each bid
- `winningCurrency` - currency of the winning bid

### 3. Updated auction create endpoint (server/routes/auctions.js)
- Accepts `currency` parameter from client
- Defaults to listing's currency if not provided
- Validates currency is uppercase

### 4. Updated auction close endpoint (server/routes/auctions.js)
- Stores `winningCurrency` from the winning bid
- Uses auction's currency as fallback

### 5. Updated CreateAuction page (client/src/pages/CreateAuction.js)
- Uses `useTheme()` hook to get user's preferred currency
- Initializes form with user's currency
- Sends currency to API when creating auction
- Displays currency symbol next to reserve price input

### Test Results:
- All 13 auction tests pass ✓
- All 18 listing tests pass ✓
- All 27 offer tests pass ✓
- All 13 offer chain tests pass ✓
- All 7 offer sharing tests pass ✓
- 71/71 relevant tests pass ✓
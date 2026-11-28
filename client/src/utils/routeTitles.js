/**
 * One page title per route.
 *
 * Before this file, `App.js` kept a short prefix list that covered about half
 * the router: /inventory, /admin, /seller-badges, /referrals and ~30 others
 * rendered fine but announced "Page not found · TrendDrop" in the tab, the
 * recents card and the share sheet (WCAG 2.4.2). This is now the single source
 * of truth for both `document.title` and the route announcement, and
 * `routeTitles.test.js` parses every `<Route path>` in App.js so a new screen
 * cannot ship without a title again.
 *
 * Order matters: a specific path has to come before the general one it
 * extends (/listing/:id/edit before /listing/:id, /auctions/create before
 * /auctions/:id).
 */

export const HOME_TITLE = 'TrendDrop — Wear the Extraordinary';
export const BRAND = 'TrendDrop';
export const NOT_FOUND = 'Page not found';

const ROUTES = [
  // Listings and people
  ['/listing/:id/edit', 'Edit listing'],
  ['/listing/:id', 'Listing'],
  ['/profile/:id', 'Profile'],
  ['/closet/:id', 'Closet'],
  ['/collections/:sellerId', 'Collection'],
  ['/reviews/:sellerId', 'Reviews'],
  ['/reviews', 'Reviews'],

  // Selling
  ['/seller/listings/bulk', 'Bulk listing manager'],
  ['/seller/onboarding', 'Become a seller'],
  ['/seller/analytics', 'Seller analytics'],
  ['/seller-dashboard', 'Seller dashboard'],
  ['/seller-badges', 'Seller badges'],
  ['/seller-communities', 'Seller communities'],
  ['/inventory', 'Inventory'],
  ['/vendors', 'Vendors'],
  ['/enterprise', 'Enterprise API'],
  ['/referrals', 'Referrals'],
  ['/fraud-protection', 'Fraud protection'],

  // Shopping
  ['/search', 'Shop'],
  ['/sell', 'Sell an item'],
  ['/feed', 'Your feed'],
  ['/cart', 'Your bag'],
  ['/wishlist', 'Wishlist'],
  ['/saved-searches', 'Saved searches'],
  ['/recently-viewed', 'Recently viewed'],
  ['/offers', 'Offers'],
  ['/offer-sharing', 'Offer sharing'],
  ['/transactions', 'Orders'],
  ['/orders/:id', 'Order details'],
  ['/returns', 'Returns'],
  ['/size-recommendation', 'Size recommendation'],
  ['/price-suggestion', 'Price suggestion'],
  ['/virtual-try-on/:listingId', 'Virtual try-on'],
  ['/virtual-try-on', 'Virtual try-on'],

  // Auctions
  ['/auctions/create', 'Create auction'],
  ['/auctions/:id', 'Auction details'],
  ['/auctions', 'Auctions'],

  // Social and account
  ['/messages', 'Messages'],
  ['/notifications', 'Notifications'],
  ['/parties', 'Parties'],
  ['/live-events', 'Live events'],
  ['/live-events/:id', 'Live event'],
  ['/trends', 'Trends'],
  ['/trend-forecast', 'Trend forecast'],
  ['/ai-stylist', 'AI stylist'],
  ['/video-shopping', 'Video shopping'],
  ['/ar-showrooms', 'AR showrooms'],
  ['/social-commerce', 'Social commerce'],
  ['/subscriptions', 'Subscriptions'],
  ['/loyalty', 'Loyalty programme'],
  ['/cross-border', 'Cross-border shopping'],
  ['/settings', 'Settings'],
  ['/mobile-settings', 'Mobile settings'],

  // Auth
  ['/login', 'Sign in'],
  ['/register', 'Create account'],
  ['/forgot-password', 'Reset password'],
  ['/reset-password', 'Choose a new password'],
  ['/verify-email', 'Verify your email'],

  // Legal, help, admin, region
  ['/legal/:type', 'Legal'],
  ['/legal', 'Legal'],
  ['/help', 'Help centre'],
  ['/admin/legal', 'Legal administration'],
  ['/admin', 'Admin'],
  ['/unavailable', 'Not available in your region'],

  ['/', 'Home'],
];

const patternToRegex = (pattern) => new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+')}$`);

const COMPILED = ROUTES.map(([pattern, name]) => [patternToRegex(pattern), name]);

const normalize = (pathname) => {
  const clean = String(pathname || '/').split('?')[0].split('#')[0].replace(/\/+$/, '');
  return clean || '/';
};

/** The human name of the screen, e.g. "Your bag" or "Page not found". */
export const pageNameForPath = (pathname) => {
  const match = COMPILED.find(([regex]) => regex.test(normalize(pathname)));
  return match ? match[1] : NOT_FOUND;
};

/** The full document title, e.g. "Your bag · TrendDrop". */
export const titleForPath = (pathname) => {
  const clean = normalize(pathname);
  if (clean === '/') return HOME_TITLE;
  return `${pageNameForPath(clean)} · ${BRAND}`;
};

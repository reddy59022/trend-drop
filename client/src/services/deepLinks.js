// Deep link utilities (TD-2.4)
//
// The native app can be opened from https links (App Links / Universal
// Links: trend-drop.onrender.com/..., trend-drop.app/...) or from the
// custom scheme (trenddrop://...). Capacitor delivers the original URL to
// the appUrlOpen listener; these helpers turn it into an in-app route.
//
// Custom-scheme URLs parse awkwardly with `new URL` (the first path
// segment becomes the host), so we normalize them to an https URL first:
//   trenddrop://listing/123  -> https://trenddrop.local/listing/123
//   trenddrop://oauth-callback?token=... -> https://trenddrop.local/oauth-callback?token=...

export function normalizeDeepLinkUrl(rawUrl) {
  if (!rawUrl) return null;
  const str = String(rawUrl);
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(str)) {
      const parsed = new URL(str);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        // Custom scheme: host holds the first path segment.
        const host = parsed.host || '';
        const rest = parsed.pathname === '/' ? '' : parsed.pathname;
        const query = parsed.search || '';
        return new URL(`https://trenddrop.local/${host}${rest}${query}`);
      }
      return parsed;
    }
    // Bare path (e.g. '/listing/abc') — used in tests and by callers that
    // already extracted the path. Only accept true path strings.
    if (!str.startsWith('/')) return null;
    return new URL(str, 'https://trenddrop.local');
  } catch (e) {
    return null;
  }
}

// Returns true when the URL looks like an OAuth redirect carrying tokens
// (Google identity platform or Apple). Also matches the legacy
// 'oauth-callback' marker for backwards compatibility.
export function isOAuthCallbackUrl(rawUrl) {
  if (!rawUrl) return false;
  const str = String(rawUrl);
  if (str.includes('oauth-callback')) return true;
  const parsed = normalizeDeepLinkUrl(str);
  if (!parsed) return false;
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path.endsWith('/callback') || path.endsWith('/oauth')) return true;
  return Boolean(parsed.searchParams.get('token') || parsed.searchParams.get('id_token'));
}

// Extract the in-app path (pathname + search + hash) from a deep link URL.
// Returns '/' when the URL has no meaningful path.
export function deepLinkPath(rawUrl) {
  const parsed = normalizeDeepLinkUrl(rawUrl);
  if (!parsed) return null;
  const path = parsed.pathname;
  if (!path || path === '/') return '/';
  return `${path}${parsed.search}${parsed.hash}`;
}

// Known in-app route prefixes. Used to decide whether a deep link should
// be routed inside the app (vs. ignored as an external link).
const APP_ROUTE_PREFIXES = [
  '/listing/',
  '/orders/',
  '/messages',
  '/profile/',
  '/closet/',
  '/collections/',
  '/auctions/',
  '/reviews/',
  '/offer-sharing',
  '/wishlist',
  '/cart',
  '/search',
];

export function isAppPath(path) {
  if (!path || path === '/') return false;
  return APP_ROUTE_PREFIXES.some((p) => path.startsWith(p));
}

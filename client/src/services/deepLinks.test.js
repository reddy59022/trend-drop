// TD-2.4 deep link parsing/routing helpers (unit tests, jsdom via react-scripts).
import {
  normalizeDeepLinkUrl,
  isOAuthCallbackUrl,
  deepLinkPath,
  isAppPath,
} from './deepLinks';

describe('normalizeDeepLinkUrl', () => {
  it('passes https URLs through unchanged', () => {
    const u = normalizeDeepLinkUrl('https://trend-drop.app/listing/abc123');
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('trend-drop.app');
    expect(u.pathname).toBe('/listing/abc123');
  });

  it('normalizes custom-scheme URLs to an https URL (host = first segment)', () => {
    const u = normalizeDeepLinkUrl('trenddrop://listing/abc123?tab=offers');
    expect(u.protocol).toBe('https:');
    expect(u.hostname).toBe('trenddrop.local');
    expect(u.pathname).toBe('/listing/abc123');
    expect(u.searchParams.get('tab')).toBe('offers');
  });

  it('normalizes oauth callback scheme URLs', () => {
    const u = normalizeDeepLinkUrl('trenddrop://oauth-callback?token=xyz');
    expect(u.pathname).toBe('/oauth-callback');
    expect(u.searchParams.get('token')).toBe('xyz');
  });

  it('accepts bare paths against a base URL', () => {
    const u = normalizeDeepLinkUrl('/messages');
    expect(u.pathname).toBe('/messages');
  });

  it('returns null for garbage input', () => {
    expect(normalizeDeepLinkUrl('')).toBeNull();
    expect(normalizeDeepLinkUrl(null)).toBeNull();
    expect(normalizeDeepLinkUrl('not a url at all')).toBeNull();
  });
});

describe('isOAuthCallbackUrl', () => {
  it('matches legacy oauth-callback marker', () => {
    expect(isOAuthCallbackUrl('trenddrop://oauth-callback?token=xyz')).toBe(true);
    expect(isOAuthCallbackUrl('https://trend-drop.app/oauth-callback?token=xyz')).toBe(true);
  });

  it('matches any /callback redirect carrying a token', () => {
    expect(isOAuthCallbackUrl('trenddrop://callback?token=xyz')).toBe(true);
    expect(isOAuthCallbackUrl('trenddrop://callback?id_token=abc')).toBe(true);
  });

  it('rejects plain listing/order deep links', () => {
    expect(isOAuthCallbackUrl('trenddrop://listing/abc123')).toBe(false);
    expect(isOAuthCallbackUrl('https://trend-drop.app/listing/abc123')).toBe(false);
    expect(isOAuthCallbackUrl('https://trend-drop.app/orders/xyz')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isOAuthCallbackUrl('')).toBe(false);
    expect(isOAuthCallbackUrl(null)).toBe(false);
    expect(isOAuthCallbackUrl(undefined)).toBe(false);
  });
});

describe('deepLinkPath', () => {
  it('extracts path + query from https links', () => {
    expect(deepLinkPath('https://trend-drop.app/listing/abc123?utm=email')).toBe('/listing/abc123?utm=email');
  });

  it('extracts path from custom-scheme links', () => {
    expect(deepLinkPath('trenddrop://orders/ord_987')).toBe('/orders/ord_987');
    expect(deepLinkPath('trenddrop://messages')).toBe('/messages');
  });

  it('returns "/" for bare home links', () => {
    expect(deepLinkPath('https://trend-drop.app/')).toBe('/');
  });
});

describe('isAppPath', () => {
  it('accepts known in-app routes', () => {
    expect(isAppPath('/listing/abc123')).toBe(true);
    expect(isAppPath('/orders/ord_1')).toBe(true);
    expect(isAppPath('/messages')).toBe(true);
    expect(isAppPath('/messages?conversation=1')).toBe(true);
    expect(isAppPath('/profile/u1')).toBe(true);
    expect(isAppPath('/auctions/auction-1')).toBe(true);
    expect(isAppPath('/search?q=jacket')).toBe(true);
  });

  it('rejects home, unknown, and empty paths', () => {
    expect(isAppPath('/')).toBe(false);
    expect(isAppPath('')).toBe(false);
    expect(isAppPath(null)).toBe(false);
    expect(isAppPath('/some/unknown/route')).toBe(false);
  });
});

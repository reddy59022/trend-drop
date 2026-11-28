/**
 * Page titles for every route.
 *
 * The old map in App.js was a short prefix list; anything missing fell through
 * to "Page not found · TrendDrop" on a page that rendered perfectly well. This
 * test reads the router itself, so a new <Route path> without a title fails
 * here instead of shipping a wrong tab label.
 */
const fs = require('fs');
const path = require('path');
const {
  pageNameForPath,
  titleForPath,
  HOME_TITLE,
  NOT_FOUND,
  BRAND,
} = require('./routeTitles');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'App.js'), 'utf8');
const routePaths = [...appSource.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
const concretePath = (pattern) => pattern.replace(/:[^/]+/g, 'sample-id');

describe('route titles', () => {
  test('the router has routes to check', () => {
    expect(routePaths.length).toBeGreaterThan(50);
  });

  test('every route in App.js has a real title, not the 404 fallback', () => {
    const missing = routePaths
      .filter((pattern) => pattern !== '*')
      .filter((pattern) => pageNameForPath(concretePath(pattern)) === NOT_FOUND);

    expect(missing).toEqual([]);
  });

  test('dynamic routes resolve to their own screen, not a neighbour', () => {
    expect(pageNameForPath('/orders/abc123')).toBe('Order details');
    expect(pageNameForPath('/listing/abc123')).toBe('Listing');
    expect(pageNameForPath('/listing/abc123/edit')).toBe('Edit listing');
    expect(pageNameForPath('/auctions/create')).toBe('Create auction');
    expect(pageNameForPath('/auctions/abc123')).toBe('Auction details');
    expect(pageNameForPath('/admin/legal')).toBe('Legal administration');
    expect(pageNameForPath('/reviews/someone')).toBe('Reviews');
    expect(pageNameForPath('/virtual-try-on/abc123')).toBe('Virtual try-on');
  });

  test('titles carry the brand and the screen name', () => {
    expect(titleForPath('/cart')).toBe(`Your bag · ${BRAND}`);
    expect(titleForPath('/inventory')).toBe(`Inventory · ${BRAND}`);
    expect(titleForPath('/admin')).toBe(`Admin · ${BRAND}`);
  });

  test('home keeps its marketing title', () => {
    expect(titleForPath('/')).toBe(HOME_TITLE);
    expect(pageNameForPath('/')).toBe('Home');
  });

  test('unknown paths still say page not found', () => {
    expect(pageNameForPath('/no-such-page')).toBe(NOT_FOUND);
    expect(titleForPath('/no-such-page')).toBe(`Page not found · ${BRAND}`);
  });

  test('trailing slashes and query strings do not change the screen name', () => {
    expect(pageNameForPath('/cart/')).toBe('Your bag');
    expect(pageNameForPath('/search?q=red')).toBe('Shop');
    expect(pageNameForPath('/messages#thread-1')).toBe('Messages');
    expect(pageNameForPath('')).toBe('Home');
  });

  test('the catch-all is the only 404 route', () => {
    expect(routePaths.filter((pattern) => pattern === '*')).toHaveLength(1);
  });
});

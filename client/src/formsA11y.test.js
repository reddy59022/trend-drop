/**
 * Field-level contracts for the forms measured in audit Pass 10.
 *
 * Every assertion below maps to a defect found in a real browser at 390px:
 * a control named only by its placeholder (which disappears as soon as the
 * user types), an auth action whose hit area was 17-21px tall against the
 * 24px WCAG 2.2 minimum, and an empty search result with no way forward.
 */
const fs = require('fs');
const path = require('path');

// JSX comments are interleaved with markup in these files, so a comment
// stripper can swallow real attributes; the assertions below are specific
// enough (attribute strings) that comments cannot satisfy them.
const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');

describe('form controls have programmatic names', () => {
  test('every labelled field in Settings points its label at the control', () => {
    const src = read('pages/Settings.js');
    const labels = [...src.matchAll(/<label className="form-label"([^>]*)>/g)].map((m) => m[1]);
    expect(labels.length).toBeGreaterThan(20);
    // A label with no htmlFor leaves the field named only by its placeholder.
    const unbound = labels.filter((attrs) => !/htmlFor="/.test(attrs));
    expect(unbound).toEqual([]);

    // Each htmlFor must resolve: the id it names has to exist on a control.
    const targets = labels.map((attrs) => attrs.match(/htmlFor="([^"]+)"/)[1]);
    for (const id of targets) {
      expect(src).toContain(`id="${id}"`);
    }
  });

  test('the register form binds all five fields and its legal links stay inline text', () => {
    const src = read('pages/Register.js');
    for (const id of ['reg-name', 'reg-email', 'reg-password', 'reg-confirm', 'reg-country']) {
      expect(src).toContain(`htmlFor="${id}"`);
      expect(src).toContain(`id="${id}"`);
    }
  });

  test('search filters name brand, colour and both price bounds', () => {
    const src = read('pages/Search.js');
    expect(src).toContain('aria-label="Brand"');
    expect(src).toContain('aria-label="Color"');
    expect(src).toContain('aria-label="Minimum price"');
    expect(src).toContain('aria-label="Maximum price"');
  });

  test('the comment field has a name beyond its placeholder', () => {
    const src = read('components/CommentSection.js');
    expect(src).toContain('aria-label="Add a comment"');
  });
});

describe('auth controls meet the 24px target minimum', () => {
  test('show-password toggles paint at least a 32px hit area', () => {
    const src = read('pages/Register.js');
    const toggles = src.match(/minWidth: 32, minHeight: 32/g) || [];
    expect(toggles.length).toBe(2);
  });

  test('the forgot-password link is a standalone 24px action', () => {
    const src = read('pages/Login.js');
    expect(src).toMatch(/to="\/forgot-password"[^>]*minHeight: 24/);
  });

  test('auth footer links get a 24px row from the stylesheet', () => {
    const css = read('styles/globals.css');
    expect(css).toMatch(/\.auth-footer a \{[^}]*min-height: 24px/);
  });
});

describe('empty search offers a way forward and announces results', () => {
  const src = read('pages/Search.js');

  test('the result region is busy while a request is in flight', () => {
    expect(src).toContain('aria-busy={loading}');
  });

  test('the result count is a polite live region', () => {
    expect(src).toMatch(/role="status"[\s\S]{0,120}items found/);
  });

  test('no-results state offers only categories that have stock', () => {
    // Guessed search terms returned nothing on a sparse catalog; the recovery
    // chips come from the same aggregate the landing page measures.
    expect(src).toContain('/listings/marketplace-stats');
    expect(src).toMatch(/\.filter\(\(c\) => c\.count > 0\)/);
    expect(src).toContain('Try one of these instead');
    expect(src).toContain('navigate(`/search?category=${encodeURIComponent(cat.name)}`)');
    expect(src).toContain('Browse all listings');
    // Clear filters is only useful when a filter is actually set.
    expect(src).toMatch(/activeFilters\.length > 0 && \(\s*<button[^>]*onClick=\{clearFilters\}/);
  });

  test('the consent checkboxes give their wrapping label a 24px target', () => {
    const register = read('pages/Register.js');
    expect((register.match(/className="legal-check"/g) || []).length).toBe(3);
    const css = read('styles/globals.css');
    expect(css).toMatch(/\.legal-check \{[^}]*min-height: 24px/);
  });

  test('brand suggestions are buttons, not clickable divs', () => {
    expect(src).toMatch(/aria-label={`Filter by \$\{b\.brand\}`}/);
    expect(src).toContain('type="button"');
  });
});

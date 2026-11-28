/**
 * Focus indicator contrast (WCAG 1.4.11 non-text contrast / focus appearance).
 *
 * Measured in Chrome at 390x844 in both themes before these tokens existed:
 *   - skip link: white ring on the light shell — 1.11:1
 *   - primary button: gold ring on the violet gradient — 1.45:1
 *   - footer link: brand violet ring on the dark footer — 2.95:1
 *   - active dock item: brand violet ring on the dark pill — 1.02:1
 *
 * The ring is now theme-aware for page surfaces, ink inside filled gradients,
 * white on the dark footer, and a two-tone ring where the backdrop is glass
 * (the dock). This test computes the ratios from the CSS source so a future
 * palette change cannot quietly drop the indicator below 3:1.
 */
const fs = require('fs');
const path = require('path');

const globals = fs.readFileSync(path.join(__dirname, 'styles/globals.css'), 'utf8');
const haul = fs.readFileSync(path.join(__dirname, 'styles/design-haul.css'), 'utf8');

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

const luminance = (hex) => {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const token = (name, occurrence = 0) => {
  const values = [...globals.matchAll(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`, 'g'))].map((m) => m[1]);
  return values[occurrence];
};

const gradientStops = (name) => {
  const line = globals.split('\n').find((l) => l.includes(`${name}:`)) || '';
  return [...line.matchAll(/#[0-9A-Fa-f]{6}/g)].map((m) => m[0]);
};

const LIGHT_RING = token('--td-focus-ring', 0);
const DARK_RING = token('--td-focus-ring', 2);
const ON_BRAND = token('--td-focus-ring-on-brand');
const ON_FILL = token('--td-focus-ring-on-fill');

const LIGHT_PAGE_SURFACES = ['#FFFFFF', '#F7F5FE', '#EDE9FA', '#F1EEFC'];
const DARK_PAGE_SURFACES = ['#08081A', '#14142B', '#1E1E3F', '#24244A'];
const DARK_BANDS = ['#08081A', '#0F0B2B', '#14142B'];

describe('focus indicator contrast', () => {
  test('the ring tokens are declared for both themes', () => {
    [LIGHT_RING, DARK_RING, ON_BRAND, ON_FILL].forEach((value) => {
      expect(value).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  test('the light ring clears 3:1 on every light page surface', () => {
    LIGHT_PAGE_SURFACES.forEach((surface) => {
      expect({ surface, ratio: Math.round(contrast(LIGHT_RING, surface) * 100) / 100 })
        .toEqual({ surface, ratio: expect.any(Number) });
      expect(contrast(LIGHT_RING, surface)).toBeGreaterThanOrEqual(3);
    });
  });

  test('the dark ring clears 3:1 on every dark page surface', () => {
    DARK_PAGE_SURFACES.forEach((surface) => {
      expect(contrast(DARK_RING, surface)).toBeGreaterThanOrEqual(3);
    });
  });

  test('the ring inside a filled control clears every gradient stop', () => {
    const brand = gradientStops('--td-gradient-brand');
    const gold = gradientStops('--td-gradient-gold');
    expect(brand.length).toBeGreaterThanOrEqual(2);
    expect(gold.length).toBeGreaterThanOrEqual(2);
    [...brand, ...gold].forEach((stop) => {
      expect(contrast(ON_FILL, stop)).toBeGreaterThanOrEqual(3);
    });
  });

  test('white clears 3:1 on the dark bands it is used on (footer)', () => {
    DARK_BANDS.forEach((band) => {
      expect(contrast(ON_BRAND, band)).toBeGreaterThanOrEqual(3);
    });
  });

  test('the global focus rules use the contrast token, not the brand colour', () => {
    expect(globals).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--td-focus-ring\)/);
    expect(haul).toMatch(/\[tabindex\]:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--td-focus-ring\)/);
    expect(haul).not.toMatch(/outline-color:\s*var\(--td-accent\)/);
    expect(haul).toMatch(/\.skip-to-content:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--td-focus-ring\)/);
  });

  test('filled gradient controls paint the ring inside the fill', () => {
    expect(haul).toMatch(/\.btn-primary:focus-visible,[^{]*\{[^}]*outline-color:\s*var\(--td-focus-ring-on-fill\)[^}]*outline-offset:\s*-6px/);
  });

  test('the dark footer and the glass dock get their own ring treatment', () => {
    // Footer: white ring, because the band is dark in both themes.
    expect(haul).toMatch(/footer a:focus-visible[^{]*\{[^}]*outline-color:\s*var\(--td-focus-ring-on-brand\)/);
    // Dock: two-tone (theme ring over a white halo) for the glass and the active pill.
    expect(haul).toMatch(/\.mobile-tab-bar a:focus-visible[^{]*\{[^}]*outline-color:\s*var\(--td-focus-ring\)[^}]*box-shadow:\s*0 0 0 3px var\(--td-focus-ring-on-brand\)/);
  });
});

/**
 * Contrast regression for --td-text-tertiary.
 *
 * This token carries timestamps, hints and meta lines at 11-13px. It used to
 * be #9494B8 on light (2.9:1 on white) and #6E6C99 on dark (4.1:1 on the
 * #08081A surface), so every small line using it failed WCAG AA. The values
 * are now #62628A / #8C8AB8; this test computes the real contrast from the
 * CSS source so a future "make it subtler" edit cannot quietly undo it.
 */
const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, 'styles/globals.css'), 'utf8');

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

const tertiaryValues = [...css.matchAll(/--td-text-tertiary:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase());
const lightTertiary = tertiaryValues[0];
const darkTertiary = tertiaryValues[1];

const LIGHT_SURFACES = { surface: '#FFFFFF', secondary: '#F7F5FE', tertiary: '#EDE9FA' };
const DARK_SURFACES = { surface: '#08081A', secondary: '#14142B', tertiary: '#1E1E3F' };

describe('--td-text-tertiary meets WCAG AA for small text', () => {
  test('both theme values are declared', () => {
    expect(lightTertiary).toMatch(/^#[0-9A-F]{6}$/);
    expect(darkTertiary).toMatch(/^#[0-9A-F]{6}$/);
    expect(tertiaryValues[2]).toBe(darkTertiary); // forced dark
    expect(tertiaryValues[3]).toBe(lightTertiary); // forced light
  });

  test('light theme is at least 4.5:1 on every surface', () => {
    Object.entries(LIGHT_SURFACES).forEach(([name, surface]) => {
      expect({ name, ratio: Math.round(contrast(lightTertiary, surface) * 100) / 100 })
        .toEqual({ name, ratio: expect.any(Number) });
      expect(contrast(lightTertiary, surface)).toBeGreaterThanOrEqual(4.5);
    });
  });

  test('dark theme is at least 4.5:1 on every surface', () => {
    Object.entries(DARK_SURFACES).forEach(([name, surface]) => {
      expect({ name, ratio: Math.round(contrast(darkTertiary, surface) * 100) / 100 })
        .toEqual({ name, ratio: expect.any(Number) });
      expect(contrast(darkTertiary, surface)).toBeGreaterThanOrEqual(4.5);
    });
  });

  test('tertiary stays dimmer than secondary, so hierarchy survives', () => {
    const secondary = [...css.matchAll(/--td-text-secondary:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1]);
    expect(contrast(lightTertiary, '#FFFFFF')).toBeLessThan(contrast(secondary[0], '#FFFFFF'));
    expect(contrast(darkTertiary, '#08081A')).toBeLessThan(contrast(secondary[1], '#08081A'));
  });

  test('the -rgb companions match their hex values', () => {
    const rgb = [...css.matchAll(/--td-text-tertiary-rgb:\s*(\d+),\s*(\d+),\s*(\d+)/g)].map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
    expect(rgb[0]).toEqual(hexToRgb(lightTertiary));
    expect(rgb[1]).toEqual(hexToRgb(darkTertiary));
  });
});

#!/usr/bin/env node
/**
 * Rasterize client/public/app-icon.svg into the PNG icon set the web/PWA
 * layer needs (see client/public/manifest.json and index.html):
 *
 *   - icon-192.png / icon-512.png  (purpose “any”, brand rounded square)
 *   - maskable-512.png             (purpose “maskable”, FULL-BLEED square —
 *                                   OS crops a circle/rounded shape itself)
 *   - apple-touch-icon-180.png     (iOS home screen; iOS composites its own
 *                                   rounded corners, so it must be full-bleed)
 *   - favicon-32.png / favicon-48.png (favicon fallback for older browsers)
 *
 * Pure-JS rasterizer (+zlib PNG encode) so the set can be regenerated
 * deterministically in any environment without browser/image tooling.
 * Sampled 3×3 per pixel for smooth edges. If the SVG artwork ever changes,
 * mirror the shape/colour changes here and re-run: node scripts/generate-app-icons.js
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT_DIR = path.join(__dirname, '..', 'client', 'public', 'img', 'icons');

// ---- shape constants transcribed from app-icon.svg (512 viewBox) ----
const R_CORNER = 116; // rounded-square corner radius

// Standard rounded-square test: inside if within shrunken rect or a corner circle
function roundedSquareSDF(x, y, s, r) {
  if (x < 0 || y < 0 || x > s || y > s) return false;
  const rx = Math.min(Math.max(x, r), s - r);
  const ry = Math.min(Math.max(y, r), s - r);
  const dx = x - rx, dy = y - ry;
  return dx * dx + dy * dy <= r * r;
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
const lerp = (a, b, t) => a + (b - a) * t;

// Aurora diagonal gradient: #6C3BFF (0%) -> #8B5CFF (52%) -> #FF6BC1 (100%)
function aurora(x, y, s) {
  const t = Math.min(1, Math.max(0, (x + y) / (2 * s)));
  const c1 = hexToRgb('#6C3BFF'), c2 = hexToRgb('#8B5CFF'), c3 = hexToRgb('#FF6BC1');
  return t < 0.52
    ? [lerp(c1[0], c2[0], t / 0.52), lerp(c1[1], c2[1], t / 0.52), lerp(c1[2], c2[2], t / 0.52)]
    : [lerp(c2[0], c3[0], (t - 0.52) / 0.48), lerp(c2[1], c3[1], (t - 0.52) / 0.48), lerp(c2[2], c3[2], (t - 0.52) / 0.48)];
}

// White "T" monogram: two rounded rects (transcribed from the SVG)
function insideRoundRect(x, y, rx, ry, w, h, r) {
  if (x < rx || x >= rx + w || y < ry || y >= ry + h) return false;
  const cx = Math.min(Math.max(x, rx + r), rx + w - r);
  const cy = Math.min(Math.max(y, ry + r), ry + h - r);
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}
function insideT(x, y) {
  return insideRoundRect(x, y, 146, 150, 220, 62, 16) || insideRoundRect(x, y, 225, 188, 62, 196, 16);
}

// Champagne-gold drop: circle r=28 at (388,172) + tangent tip toward (388,108)
function insideDrop(x, y) {
  const dx = x - 388, dy = y - 172;
  if (dx * dx + dy * dy <= 28 * 28) return true;
  // tip triangle with slightly curved sides — triangle approx is fine at icon sizes
  if (y >= 108 && y <= 150) {
    const half = (y - 108) / (150 - 108) * 28; // widen from point to the circle's width
    return Math.abs(dx) <= half;
  }
  return false;
}
function dropColor(y) {
  const t = Math.min(1, Math.max(0, (y - 108) / (200 - 108)));
  const c1 = hexToRgb('#FFD700'), c2 = hexToRgb('#FFB86B');
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

// Best-of-N solid-composite pixel colour at s×s, supersampled SS×SS
function sample(x, y, s, fullBleed) {
  const SS = 3;
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      const bgOK = fullBleed ? (px >= 0 && py >= 0 && px <= s && py <= s) : roundedSquareSDF(px, py, s, R_CORNER);
      let col = [0, 0, 0], alpha = 0;
      if (bgOK) {
        col = aurora(px, py, s); alpha = 255;
        if (insideT(px, py)) col = [255, 255, 255];
        else if (insideDrop(px, py)) col = dropColor(py);
      }
      if (alpha === 0) { n++; a += 0; continue; }
      r += col[0] * alpha; g += col[1] * alpha; b += col[2] * alpha; a += alpha; n++;
    }
  }
  const A = a / n;
  if (A === 0) return [0, 0, 0, 0];
  // r/g/b accumulated col * 255; Σ255 == a, so r/a is the straight mean colour
  // and a/n is the straight coverage alpha.
  return [Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(A)];
}

// ---- minimal PNG encoder (RGBA8, no filter) ----
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rows) {
  const h = rows.length, w = rows[0].length / 4;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const stride = 1 + rows[0].length; // filter byte + one RGBA row
  const raw = Buffer.alloc(rows.length * stride);
  rows.forEach((row, i) => {
    raw[i * stride] = 0; // filter type: none
    row.copy(raw, i * stride + 1);
  });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function render(size, fullBleed) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size * 4);
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = sample(x, y, size, fullBleed);
      row[x * 4] = r; row[x * 4 + 1] = g; row[x * 4 + 2] = b; row[x * 4 + 3] = a;
    }
    rows.push(row);
  }
  return encodePNG(rows);
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const targets = [
  ['icon-192.png', 192, false, 'any'],
  ['icon-512.png', 512, false, 'any'],
  ['maskable-512.png', 512, true, 'maskable'],
  ['apple-touch-icon-180.png', 180, true, 'ios'],
  ['favicon-48.png', 48, false, 'favicon'],
];
targets.forEach(([name, size, fullBleed]) => {
  fs.writeFileSync(path.join(OUT_DIR, name), render(size, fullBleed));
  console.log(`wrote ${name} (${size}x${size}${fullBleed ? ', full-bleed' : ''})`);
});

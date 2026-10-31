#!/usr/bin/env node
/* Design-review screenshot helper (local QA only): captures the app's key
   surfaces on desktop + mobile in both themes into artifacts/. */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const OUT = 'artifacts/shots';
// Use the full chromium we already have — avoids the separate headless-shell download.
const CHROME = path.join(os.homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome');

const PAGES = [
  ['home', '/'],
  ['search', '/search?sort=popular'],
  ['feed', '/feed'],
  ['listing', null], // filled after surface scan: first listing click-through
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  for (const theme of ['light', 'dark']) {
    for (const [name, vp] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
      // fresh context per run; theme is client-persisted via localStorage
      const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2 });
      await ctx.addInitScript((t) => localStorage.setItem('theme', t), theme);
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      for (const [routeName, path] of PAGES) {
        if (!path) continue;
        await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(1200);
        await page.screenshot({ path: `${OUT}/${routeName}_${name}_${theme}.png`, fullPage: false });
      }
      if (errors.length) console.log(`[${theme} ${name}] console errors:`, errors.slice(0, 3).join(' | '));
      await ctx.close();
    }
  }
  await browser.close();
  console.log('done');
})();

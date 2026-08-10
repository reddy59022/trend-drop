const { chromium } = require('@playwright/test');
const { login, clearCart, addJacketToCart, BUYER } = require('./helpers');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ baseURL: 'http://localhost:5001' });
  await login(page, BUYER);
  await clearCart(page);
  await page.reload();
  await addJacketToCart(page);
  await page.goto('/cart');
  await page.getByText('Vintage Denim Jacket').first().waitFor({ timeout: 15000 });
  const btn = page.getByRole('button', { name: /proceed to checkout/i });
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  await page.locator('form').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(4000);
  const frames = page.frames().map(f => ({ url: f.url().slice(0, 80), title: f.name() }));
  console.log('FRAMES:', JSON.stringify(frames, null, 2));
  const iframes = await page.locator('iframe').count();
  console.log('iframe count:', iframes);
  const forms = await page.locator('form').count();
  console.log('form count:', forms);
  const bodyText = (await page.locator('body').innerText()).slice(0, 400);
  console.log('BODY:', bodyText);
  await browser.close();
})();

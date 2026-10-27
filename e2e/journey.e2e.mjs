// Browser journey against the real server. Run with: npm run test:e2e
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 4900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server, browser;

test.before(async () => {
  server = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  browser = await chromium.launch();
});
test.after(async () => { await browser?.close(); server?.kill(); });

test('ask the Express docs: the answer is marked in the source, and an off-topic question is refused', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${BASE}/app`);
  await page.getByRole('button', { name: /route path optional/ }).click();
  await page.locator('#ans mark').waitFor();
  assert.match(await page.locator('#ans').innerText(), /braces/i);
  await page.getByText('ANSWER', { exact: true }).first().waitFor(); // the cited passage is flagged

  await page.locator('#q').fill('How do I bake sourdough bread?');
  await page.locator('#q').press('Enter');
  await page.getByText('Not in the docs.').waitFor();
  assert.deepEqual(errors, []);
  await page.close();
});

test('paste your own document, ask a plain question, then remove it', async () => {
  const page = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  await page.goto(`${BASE}/app`);
  await page.getByRole('tab', { name: 'Your documents' }).click();
  await page.getByText('Or paste text').click();
  await page.locator('#pasted').fill('# Leave policy\n## Annual leave\nEmployees get 24 days of paid annual leave each year.\n## Sick leave\nSick leave is 12 days a year.');
  await page.getByRole('button', { name: /index documents/i }).click();
  await page.locator('#indexedNote').getByText(/Indexed 1 document/).waitFor();
  await page.locator('#q').fill('How many days of annual leave do employees get?');
  await page.locator('#q').press('Enter');
  await page.locator('#ans mark').waitFor();
  assert.match(await page.locator('#ans').innerText(), /24 days/);
  await page.getByRole('button', { name: /remove my documents/i }).click();
  await page.close();
});

test('the app fits a phone screen', async () => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const path of ['/', '/app']) {
    await page.goto(BASE + path);
    assert.ok((await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 1, `${path} scrolls sideways`);
  }
  await page.close();
});

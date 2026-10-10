import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

const PORT = 4195, base = `http://127.0.0.1:${PORT}`;
let child;
before(async () => {
  child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(PORT), GEMINI_API_KEY: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => { child.stdout.on('data', d => String(d).includes('ready') && resolve()); child.on('error', reject); setTimeout(() => reject(new Error('server did not start')), 8000); });
});
after(() => child.kill());

const ask = async question => {
  const res = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
  const text = await res.text();
  return { res, events: text.split('\n\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))) };
};

test('health reports corpus size and extractive mode without a key', async () => {
  const h = await (await fetch(`${base}/api/health`)).json();
  assert.equal(h.mode, 'extractive');
  assert.equal(h.docs, 16);
});

test('an answerable question streams sources first, then a cited answer', async () => {
  const { res, events } = await ask('How do I make part of a route path optional?');
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  assert.equal(events[0].type, 'sources');
  const answer = events.find(e => e.type === 'answer');
  assert.equal(answer.abstained, false);
  assert.match(answer.text, /braces/);
  assert.ok(answer.citations.length >= 1);
});

test('a question the docs do not cover is refused, not answered', async () => {
  const { events } = await ask('How do I protect against CSRF attacks?');
  const answer = events.find(e => e.type === 'answer');
  assert.equal(answer.abstained, true);
  assert.equal(answer.text, '');
});

test('input is validated: empty, oversized and malformed bodies are rejected', async () => {
  const post = body => fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal((await post(JSON.stringify({ question: '  ' }))).status, 400);
  assert.equal((await post(JSON.stringify({ question: 'x'.repeat(401) }))).status, 400);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post(JSON.stringify({ question: 'x', pad: 'y'.repeat(5000) }))).status, 413);
});

test('only public/ is served and security headers are set', async () => {
  for (const path of ['/server.mjs', '/package.json', '/../package.json', '/%2e%2e/package.json', '/corpus/LICENSE.md']) assert.equal((await fetch(`${base}${path}`)).status, 404, path);
  const home = await fetch(`${base}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-frame-options'), 'DENY');
});

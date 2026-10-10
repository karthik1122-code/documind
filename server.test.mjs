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

const POLICY = `# Office handbook

## Pets

Dogs are allowed in the lobby only on a leash. Cats are not allowed anywhere in the building.

## Parking

Visitors may park in the north garage for up to four hours. Staff parking permits are renewed every January.

## Remote work

Employees may work from home on Tuesdays and Thursdays with manager approval.
`;
const upload = (files, raw) => fetch(`${base}/api/collections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw ?? JSON.stringify({ files }) });
const askIn = async (collection, question) => {
  const res = await fetch(`${base}/api/ask`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question, collection }) });
  const text = await res.text();
  return { res, events: res.headers.get('content-type').includes('event-stream') ? text.split('\n\n').filter(l => l.startsWith('data:')).map(l => JSON.parse(l.slice(5))) : [JSON.parse(text)] };
};

test('your documents: index, ask with a citation, refuse an uncovered question, then remove', async () => {
  const made = await upload([{ name: 'handbook.md', text: POLICY }]);
  assert.equal(made.status, 201);
  const { id, docs, chunks } = await made.json();
  assert.match(id, /^[0-9a-f]{32}$/); assert.deepEqual(docs, ['handbook.md']); assert.ok(chunks >= 3);

  const good = (await askIn(id, 'Are dogs allowed in the lobby?')).events;
  assert.equal(good[0].type, 'sources');
  assert.match(good[0].sources[0].file, /handbook/);
  const answer = good.find(e => e.type === 'answer');
  assert.equal(answer.abstained, false); assert.match(answer.text, /leash/i);

  const off = (await askIn(id, 'What is the capital of Australia?')).events.find(e => e.type === 'answer');
  assert.equal(off.abstained, true);

  assert.equal((await fetch(`${base}/api/collections/${id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await askIn(id, 'Are dogs allowed in the lobby?')).res.status, 404);
});

test('your documents: unknown ids, bad types, empty text and oversize uploads are refused with a reason', async () => {
  assert.equal((await askIn('0'.repeat(32), 'anything')).res.status, 404);
  assert.equal((await askIn('../../etc/passwd', 'anything')).res.status, 404);
  const bad = await upload([{ name: 'virus.exe', text: 'x' }]); assert.equal(bad.status, 400); assert.match((await bad.json()).message, /not a .md/);
  assert.equal((await upload([{ name: 'a.txt', text: '   ' }])).status, 400);
  assert.equal((await upload([])).status, 400);
  assert.equal((await upload(Array.from({ length: 9 }, (_, i) => ({ name: `f${i}.txt`, text: 'x' })))).status, 400);
  const big = await upload([{ name: 'big.txt', text: 'word '.repeat(40000) }]); assert.equal(big.status, 413);
  const huge = await upload(null, JSON.stringify({ files: [{ name: 'h.txt', text: 'x'.repeat(300 * 1024) }] })).catch(() => ({ status: 413 })); assert.equal(huge.status, 413);
  assert.equal((await upload(null, '{nope')).status, 400);
  const path = await upload([{ name: '../../../etc/cron.d/x.md', text: '# Hi\n\n## A\n\nBody text here.' }]);
  assert.equal(path.status, 201); assert.deepEqual((await path.json()).docs, ['x.md'], 'directory parts are stripped from names');
});

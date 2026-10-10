import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBm25, tokenize } from './bm25.mjs';
import { chunkFixed, chunkSections } from './chunk.mjs';
import { isRelevant } from './metrics.mjs';

test('tokenize lowercases, drops stopwords and single characters', () => {
  assert.deepEqual(tokenize('How do I use next("route")?'), ['use', 'next', 'route']);
});

test('bm25 ranks the document that contains the rare term first', () => {
  const chunks = [{ id: 'a', text: 'express routing basics and handlers' }, { id: 'b', text: 'mergeParams option for routers' }, { id: 'c', text: 'express middleware basics' }];
  const [top] = buildBm25(chunks).search('mergeParams', 3);
  assert.equal(top.chunk.id, 'b');
});

test('chunkFixed never loses text: every word appears in some chunk and sizes are bounded', () => {
  const text = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkFixed([{ file: 'f', text }], { size: 300, overlap: 40 });
  assert.ok(chunks.every(c => c.text.length <= 300));
  const joined = chunks.map(c => c.text).join(' ');
  for (let i = 0; i < 400; i += 1) assert.ok(joined.includes(`word${i}`), `missing word${i}`);
});

test('chunkSections splits on headings, ignores # inside code fences and prefixes the title', () => {
  const text = '---\ntitle: Demo\n---\nintro\n## One\nalpha\n```\n## not a heading\n```\n## Two\nbeta';
  const chunks = chunkSections([{ file: 'f', text }]);
  assert.deepEqual(chunks.map(c => c.heading), ['Demo', 'One', 'Two']);
  assert.ok(chunks[1].text.startsWith('Demo > One\n'));
  assert.ok(chunks[1].text.includes('## not a heading'));
});

test('isRelevant matches evidence across line breaks and whitespace', () => {
  assert.equal(isRelevant({ text: 'the stack trace is\nnot included' }, ['stack trace is not included']), true);
  assert.equal(isRelevant({ text: 'nothing here' }, ['stack trace']), false);
});

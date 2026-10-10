import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPipeline } from '../src/pipeline.mjs';
import { containsEvidence } from '../src/answer.mjs';

// Regression gate for the shipped default pipeline: it must never answer a question the docs do not
// cover, and its answer rate must not silently collapse.
const pipeline = createPipeline({ corpusDir: new URL('../corpus', import.meta.url).pathname });
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));
const final = async q => { let a; for await (const e of pipeline.ask(q.question)) if (e.type === 'answer') a = e; return a; };

test('no false answers on the unanswerable questions', async () => {
  const falseAnswers = [];
  for (const q of questions.filter(q => q.type === 'unanswerable')) if (!(await final(q)).abstained) falseAnswers.push(q.id);
  assert.deepEqual(falseAnswers, []);
});

test('at least 20% of answerable questions are answered with the evidence sentence', async () => {
  const answerable = questions.filter(q => q.type !== 'unanswerable');
  let ok = 0;
  for (const q of answerable) { const a = await final(q); if (!a.abstained && containsEvidence(a.text, q.evidence)) ok += 1; }
  assert.ok(ok / answerable.length >= 0.2, `answered ${ok}/${answerable.length}`);
});

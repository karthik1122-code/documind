import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from './pipeline.mjs';

const leave = [{ file: 'leave.md', text: '# Leave policy\n## Annual leave\nEmployees get 24 days of paid annual leave each year. Unused leave expires on 31 March.\n## Sick leave\nSick leave is 12 days a year and needs a doctor note after two days.' }];
const collect = async gen => { const out = []; for await (const e of gen) out.push(e); return out; };

test('small document sets: everyday question words do not trigger a refusal', async () => {
  const p = createPipeline({ docs: leave });
  const answer = (await collect(p.ask('How many days of annual leave do employees get?'))).at(-1);
  assert.equal(answer.abstained, false);
  assert.match(answer.text, /24 days/);
  const off = (await collect(p.ask('What is the parking policy for visitors?'))).at(-1);
  assert.equal(off.abstained, true, 'a question the document does not cover is still refused');
});

test('when the model fails, the user gets the extractive answer with a note instead of an error', async () => {
  const llm = { name: 'gemini:test', async *stream() { throw Object.assign(new Error('Gemini 503'), { status: 503 }); } };
  const p = createPipeline({ docs: leave, llm });
  const events = await collect(p.ask('How many days of annual leave do employees get?'));
  const answer = events.at(-1);
  assert.equal(answer.type, 'answer');
  assert.equal(answer.mode, 'extractive');
  assert.match(answer.note, /unavailable/);
  assert.match(answer.text, /24 days/);
});

test('a model that hangs is cut off by the timeout', async () => {
  const llm = { name: 'gemini:test', async *stream({ signal }) { await new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))); } };
  const p = createPipeline({ docs: leave, llm, llmTimeoutMs: 50 });
  const answer = (await collect(p.ask('How many days of annual leave do employees get?'))).at(-1);
  assert.match(answer.note, /took too long/);
});

test('a working model streams deltas and its cited answer', async () => {
  const llm = { name: 'gemini:test', async *stream() { yield 'Employees get 24 days '; yield 'of annual leave [1].'; } };
  const p = createPipeline({ docs: leave, llm });
  const events = await collect(p.ask('How many days of annual leave do employees get?'));
  assert.deepEqual(events.filter(e => e.type === 'delta').map(e => e.text), ['Employees get 24 days ', 'of annual leave [1].']);
  const answer = events.at(-1);
  assert.equal(answer.mode, 'gemini:test');
  assert.equal(answer.citations[0].file, 'leave.md');
});

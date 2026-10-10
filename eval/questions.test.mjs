import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('every evidence phrase in questions.json exists in the corpus', () => {
  const out = execFileSync(process.execPath, ['eval/verify-questions.mjs'], { encoding: 'utf8' });
  assert.match(out, /"problems":0/);
});

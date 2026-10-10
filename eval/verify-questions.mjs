// Confirms every evidence phrase really exists in the corpus, so no question depends on memory.
import { readFileSync, readdirSync } from 'node:fs';
const norm = s => s.replace(/\s+/g, ' ');
const docs = readdirSync('corpus').filter(f => f.endsWith('.mdx')).map(f => [f, norm(readFileSync(`corpus/${f}`, 'utf8'))]);
const questions = JSON.parse(readFileSync('eval/questions.json', 'utf8'));
let bad = 0;
for (const q of questions) {
  for (const e of q.evidence) {
    const hits = docs.filter(([, t]) => t.includes(norm(e))).map(([f]) => f);
    if (hits.length === 0) { bad += 1; console.log(`MISSING ${q.id}: ${e}`); }
  }
  if (q.type === 'unanswerable' && q.evidence.length) { bad += 1; console.log(`UNANSWERABLE WITH EVIDENCE ${q.id}`); }
  if (q.type !== 'unanswerable' && !q.evidence.length) { bad += 1; console.log(`NO EVIDENCE ${q.id}`); }
}
const counts = questions.reduce((a, q) => (a[q.type] = (a[q.type] || 0) + 1, a), {});
console.log(JSON.stringify({ questions: questions.length, counts, problems: bad }));
process.exit(bad ? 1 : 0);

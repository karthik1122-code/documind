import { readFileSync, writeFileSync } from 'node:fs';
import { loadCorpus } from '../src/corpus.mjs';
import { chunkSections } from '../src/chunk.mjs';
import { buildBm25 } from '../src/bm25.mjs';
import { buildLsa } from '../src/lsa.mjs';
import { rrf } from '../src/hybrid.mjs';
import { buildReranker } from '../src/rerank.mjs';
import { buildAnswerer, containsEvidence } from '../src/answer.mjs';
import { tokenize } from '../src/bm25.mjs';

const docs = loadCorpus(new URL('../corpus', import.meta.url).pathname);
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));
const chunks = chunkSections(docs, { maxChars: 800 });
const retriever = buildReranker(rrf([buildBm25(chunks, { stemming: true }), buildLsa(chunks, { dim: 50 })]), chunks);
const answerer = buildAnswerer(chunks);

const f1 = (a, b) => { const A = tokenize(a, { stemming: true }), B = tokenize(b, { stemming: true }); if (!A.length || !B.length) return 0; const bag = new Map(); for (const t of B) bag.set(t, (bag.get(t) || 0) + 1); let hit = 0; for (const t of A) if (bag.get(t) > 0) { hit += 1; bag.set(t, bag.get(t) - 1); } if (!hit) return 0; const p = hit / A.length, r = hit / B.length; return 2 * p * r / (p + r); };

// Dev / test split by position so the threshold is chosen on one half and reported on the other.
const items = questions.map((q, i) => ({ q, split: i % 2 === 0 ? 'dev' : 'test', results: retriever.search(q.question, 5) }));

const isCorrect = (a, q) => containsEvidence(a.text, q.evidence) || f1(a.text, q.answer) >= 0.4;

function evaluate(cov, oov, subset) {
  answerer.setThreshold(cov, oov);
  let answerable = 0, ok = 0, strict = 0, unans = 0, refused = 0, wrong = 0;
  for (const { q, results } of subset) {
    const a = answerer.answer(q.question, results);
    if (q.type === 'unanswerable') { unans += 1; if (a.abstained) refused += 1; }
    else { answerable += 1; if (!a.abstained) { if (isCorrect(a, q)) ok += 1; else wrong += 1; if (containsEvidence(a.text, q.evidence)) strict += 1; } }
  }
  const tpr = answerable ? ok / answerable : 0, tnr = unans ? refused / unans : 0;
  return { cov, oov, answerable, unans, correct: tpr, strict: answerable ? strict / answerable : 0, wrong, refused: tnr, falseAnswers: unans - refused, bal: (tpr + tnr) / 2 };
}

const covs = [0.2, 0.3, 0.4, 0.5], oovs = [0.15, 0.25, 0.35, 1];
const dev = items.filter(i => i.split === 'dev'), test = items.filter(i => i.split === 'test');
const grid = covs.flatMap(c => oovs.map(o => evaluate(c, o, dev)));
const best = [...grid].sort((a, b) => b.bal - a.bal || a.falseAnswers - b.falseAnswers || a.wrong - b.wrong)[0];
const pct = x => (x * 100).toFixed(0) + '%';
const header = '| Min coverage | Max unknown-word share | Answerable answered correctly | Answered wrongly | Unanswerable refused | False answers | Balanced accuracy |\n|---|---|---|---|---|---|---|';
const row = r => `| ${r.cov} | ${r.oov === 1 ? 'off' : r.oov} | ${pct(r.correct)} | ${r.wrong} | ${pct(r.refused)} | ${r.falseAnswers} | ${pct(r.bal)} |`;
const out = [
  `Setting chosen on the dev half (${dev.length} questions): min coverage ${best.cov}, max unknown-word share ${best.oov === 1 ? 'off' : best.oov}`, '',
  '### Dev half (all settings tried)', '', header, ...grid.map(row), '',
  '### Test half at the chosen setting (never used to choose it)', '', header, row(evaluate(best.cov, best.oov, test)), '',
  '### All 50 questions at the chosen setting', '', header, row(evaluate(best.cov, best.oov, items)),
].join('\n');
console.log(out);
const all = evaluate(best.cov, best.oov, items);
console.log('\nStrict (evidence phrase present) on all answerable:', pct(all.strict));
answerer.setThreshold(best.cov, best.oov);
const failures = [];
for (const { q, results } of items) { const a = answerer.answer(q.question, results); if (q.type === 'unanswerable' && !a.abstained) failures.push(`FALSE ANSWER ${q.id}: ${q.question} -> ${a.text.slice(0, 100)}`); if (q.type !== 'unanswerable' && a.abstained) failures.push(`ABSTAINED ${q.id} (${a.reason} cov ${(a.confidence||0).toFixed(2)} oov ${a.oov.toFixed(2)}): ${q.question}`); if (q.type !== 'unanswerable' && !a.abstained && !isCorrect(a, q)) failures.push(`WRONG ${q.id}: ${q.question} -> ${a.text.slice(0, 100)}`); }
console.log('\n' + failures.join('\n'));
if (process.argv.includes('--write')) writeFileSync(new URL('./results/answer-eval.md', import.meta.url), out + '\n');

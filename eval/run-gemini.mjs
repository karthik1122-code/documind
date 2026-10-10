// Adds neural dense retrieval rows. Needs GEMINI_API_KEY. Not run in CI.
//   GEMINI_API_KEY=... npm run eval:gemini
import { readFileSync, writeFileSync } from 'node:fs';
import { loadCorpus } from '../src/corpus.mjs';
import { chunkSections } from '../src/chunk.mjs';
import { buildBm25 } from '../src/bm25.mjs';
import { buildLsa } from '../src/lsa.mjs';
import { buildReranker } from '../src/rerank.mjs';
import { isRelevant } from '../src/metrics.mjs';
import { createGemini, buildDenseIndex } from '../src/providers.mjs';

const docs = loadCorpus(new URL('../corpus', import.meta.url).pathname);
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8')).filter(q => q.type !== 'unanswerable');
const chunks = chunkSections(docs, { maxChars: 800 });
const gemini = createGemini();
const dense = await buildDenseIndex(chunks, gemini);
const bm25s = buildBm25(chunks, { stemming: true });
const lsa = buildLsa(chunks, { dim: 50 });

const fuse = async (query, k, lists, c = 60) => {
  const scores = new Map();
  for (const list of lists) list.forEach((r, i) => { const e = scores.get(r.chunk.id) || { chunk: r.chunk, score: 0 }; e.score += 1 / (c + i + 1); scores.set(r.chunk.id, e); });
  return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, k);
};
const methods = {
  'Gemini dense': async q => dense.search(q, 10),
  'Hybrid: BM25s + Gemini dense (RRF)': async q => fuse(q, 10, [bm25s.search(q, 50), await dense.search(q, 50)]),
  'Hybrid: BM25s + LSA + Gemini dense (RRF)': async q => fuse(q, 10, [bm25s.search(q, 50), lsa.search(q, 50), await dense.search(q, 50)]),
};
const reranked = async q => { const cands = await methods['Hybrid: BM25s + Gemini dense (RRF)'](q); return buildReranker({ search: () => cands }, chunks).search(q, 10); };
methods['Hybrid BM25s + Gemini dense + reranker'] = reranked;

const pct = x => (x * 100).toFixed(1) + '%';
const lines = ['| Method | recall@1 | recall@3 | recall@5 | MRR | Misses at k=5 |', '|---|---|---|---|---|---|'];
for (const [name, search] of Object.entries(methods)) {
  const ranks = [];
  for (const q of questions) { const res = await search(q.question); const i = res.findIndex(r => isRelevant(r.chunk, q.evidence)); ranks.push({ id: q.id, rank: i < 0 ? null : i + 1 }); }
  const at = k => ranks.filter(r => r.rank && r.rank <= k).length / ranks.length;
  const mrr = ranks.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / ranks.length;
  lines.push(`| ${name} | ${pct(at(1))} | ${pct(at(3))} | ${pct(at(5))} | ${mrr.toFixed(3)} | ${ranks.filter(r => !r.rank || r.rank > 5).map(r => r.id).join(', ') || 'none'} |`);
}
console.log(lines.join('\n'));
if (process.argv.includes('--write')) writeFileSync(new URL('./results/gemini-retrieval.md', import.meta.url), lines.join('\n') + '\n');

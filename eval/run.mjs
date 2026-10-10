import { readFileSync, writeFileSync } from 'node:fs';
import { loadCorpus } from '../src/corpus.mjs';
import { chunkFixed, chunkSections } from '../src/chunk.mjs';
import { buildBm25 } from '../src/bm25.mjs';
import { scoreRetriever } from '../src/metrics.mjs';

const docs = loadCorpus(new URL('../corpus', import.meta.url).pathname);
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));

const configs = [
  { name: 'fixed-400',  chunks: chunkFixed(docs, { size: 400,  overlap: 60 }) },
  { name: 'fixed-800',  chunks: chunkFixed(docs, { size: 800,  overlap: 100 }) },
  { name: 'fixed-1600', chunks: chunkFixed(docs, { size: 1600, overlap: 200 }) },
  { name: 'sections-1600', chunks: chunkSections(docs, { maxChars: 1600 }) },
  { name: 'sections-800',  chunks: chunkSections(docs, { maxChars: 800 }) },
];

const results = configs.map(({ name, chunks }) => {
  const r = scoreRetriever(buildBm25(chunks).search, questions);
  return { name, chunks: chunks.length, ...r };
});

const pct = x => (x * 100).toFixed(1) + '%';
const lines = ['| Config | Chunks | recall@1 | recall@3 | recall@5 | MRR | Context at k=3 (chars) |', '|---|---|---|---|---|---|---|',
  ...results.map(r => `| ${r.name} | ${r.chunks} | ${pct(r['recall@1'])} | ${pct(r['recall@3'])} | ${pct(r['recall@5'])} | ${r.mrr} | ${r.contextChars3} |`)];
console.log(lines.join('\n'));
const best = [...results].sort((a, b) => b['recall@3'] - a['recall@3'] || b.mrr - a.mrr)[0];
console.log(`\nBest by recall@3: ${best.name}`);
console.log('By type (recall@3):', JSON.stringify(best.byType));
console.log('Misses at k=5:', best.misses.join(', ') || 'none');
console.log('Top BM25 score on unanswerable questions:', best.unanswerableTop.map(u => `${u.id}=${u.top}`).join(' '));
const answerableTop = best.rows.map(r => r.top).sort((a, b) => a - b);
console.log(`Top BM25 score on answerable: min ${answerableTop[0].toFixed(2)}, median ${answerableTop[Math.floor(answerableTop.length / 2)].toFixed(2)}`);
if (process.argv.includes('--write')) writeFileSync(new URL('./results/bm25-baseline.json', import.meta.url), JSON.stringify({ questions: questions.length, results: results.map(({ rows, ...r }) => r) }, null, 2));

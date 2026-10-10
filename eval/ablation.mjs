import { readFileSync, writeFileSync } from 'node:fs';
import { loadCorpus } from '../src/corpus.mjs';
import { chunkSections } from '../src/chunk.mjs';
import { buildBm25 } from '../src/bm25.mjs';
import { buildLsa } from '../src/lsa.mjs';
import { buildHashIndex } from '../src/hashvec.mjs';
import { rrf } from '../src/hybrid.mjs';
import { buildReranker } from '../src/rerank.mjs';
import { scoreRetriever } from '../src/metrics.mjs';

const docs = loadCorpus(new URL('../corpus', import.meta.url).pathname);
const questions = JSON.parse(readFileSync(new URL('./questions.json', import.meta.url), 'utf8'));
const pct = x => (x * 100).toFixed(1) + '%';

export function methods(chunks, { lsaDim = 50 } = {}) {
  const bm25 = buildBm25(chunks);
  const bm25s = buildBm25(chunks, { stemming: true });
  const hash = buildHashIndex(chunks);
  const lsa = buildLsa(chunks, { dim: lsaDim });
  const hybrid2 = rrf([bm25s, lsa]);
  const hybrid3 = rrf([bm25s, lsa, hash]);
  return [
    ['BM25', bm25],
    ['BM25 + stemming', bm25s],
    ['Hashed n-gram vectors', hash],
    [`LSA (${lsa.dim} dims)`, lsa],
    ['Hybrid: BM25s + LSA (RRF)', hybrid2],
    ['Hybrid: BM25s + LSA + hash (RRF)', hybrid3],
    ['BM25s + reranker', buildReranker(bm25s, chunks)],
    ['Hybrid BM25s + LSA + reranker', buildReranker(hybrid2, chunks)],
  ];
}

function table(title, chunks, opts) {
  const rows = methods(chunks, opts).map(([name, searcher]) => ({ name, ...scoreRetriever(searcher.search.bind(searcher), questions) }));
  const out = [`### ${title} (${chunks.length} chunks)`, '', '| Method | recall@1 | recall@3 | recall@5 | MRR | paraphrase recall@3 | Misses at k=5 |', '|---|---|---|---|---|---|---|',
    ...rows.map(r => `| ${r.name} | ${pct(r['recall@1'])} | ${pct(r['recall@3'])} | ${pct(r['recall@5'])} | ${r.mrr} | ${pct(r.byType.paraphrase['recall@3'])} | ${r.misses.join(', ') || 'none'} |`)];
  return { text: out.join('\n'), rows };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = table('Sections, max 800 chars', chunkSections(docs, { maxChars: 800 }));
  const b = table('Sections, max 1600 chars', chunkSections(docs, { maxChars: 1600 }));
  console.log(a.text + '\n\n' + b.text);
  const sens = [20, 50, 100].map(dim => { const chunks = chunkSections(docs, { maxChars: 800 }); const m = methods(chunks, { lsaDim: dim }); const lsa = m[3][1]; const r = scoreRetriever(lsa.search.bind(lsa), questions); return `| ${dim} | ${pct(r['recall@1'])} | ${pct(r['recall@3'])} | ${pct(r['recall@5'])} | ${r.mrr} |`; });
  console.log('\n### LSA dimension sensitivity (sections 800)\n\n| Dims | recall@1 | recall@3 | recall@5 | MRR |\n|---|---|---|---|---|\n' + sens.join('\n'));
  if (process.argv.includes('--write')) writeFileSync(new URL('./results/ablation.md', import.meta.url), a.text + '\n\n' + b.text + '\n');
}

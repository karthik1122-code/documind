import { tokenize } from './bm25.mjs';
import { stem } from './stem.mjs';

/**
 * Feature-based reranker over a candidate list. Weights are fixed up front, not fitted:
 *   0.35 IDF-weighted share of query terms present in the chunk
 *   0.25 share of query word pairs that appear next to each other in the chunk
 *   0.30 best single sentence's IDF-weighted term coverage (answers are usually one sentence)
 *   0.10 share of query terms found in the heading
 */
export function buildReranker(base, chunks, { depth = 20, weights = { cover: 0.35, pairs: 0.25, sentence: 0.3, heading: 0.1 } } = {}) {
  const toks = text => tokenize(text, { stemming: true });
  const df = new Map();
  for (const c of chunks) for (const t of new Set(toks(c.text))) df.set(t, (df.get(t) || 0) + 1);
  const idf = t => Math.log((chunks.length + 1) / ((df.get(t) || 0) + 1)) + 1;
  const mass = terms => terms.reduce((s, t) => s + idf(t), 0) || 1;

  function features(queryTerms, queryPairs, chunk) {
    const tokens = toks(chunk.text);
    const set = new Set(tokens);
    const pairSet = new Set(tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`));
    const cover = mass(queryTerms.filter(t => set.has(t))) / mass(queryTerms);
    const pairs = queryPairs.length ? queryPairs.filter(p => pairSet.has(p)).length / queryPairs.length : 0;
    const sentences = chunk.text.split(/(?<=[.!?])\s+|\n+/);
    let sentence = 0;
    for (const s of sentences) { const st = new Set(toks(s)); sentence = Math.max(sentence, mass(queryTerms.filter(t => st.has(t))) / mass(queryTerms)); }
    const head = new Set(toks(chunk.heading || ''));
    const heading = queryTerms.length ? queryTerms.filter(t => head.has(t)).length / queryTerms.length : 0;
    return { cover, pairs, sentence, heading };
  }

  return {
    search(query, k = 10) {
      const queryTerms = [...new Set(toks(query))];
      const ordered = toks(query);
      const queryPairs = ordered.slice(1).map((t, i) => `${ordered[i]}_${t}`);
      return base.search(query, depth).map(r => {
        const f = features(queryTerms, queryPairs, r.chunk);
        const score = weights.cover * f.cover + weights.pairs * f.pairs + weights.sentence * f.sentence + weights.heading * f.heading;
        return { chunk: r.chunk, score, baseScore: r.score };
      }).sort((a, b) => b.score - a.score || b.baseScore - a.baseScore).slice(0, k);
    },
  };
}

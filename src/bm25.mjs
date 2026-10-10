const STOP = new Set('a an and are as at be by can do does for from has have how i if in is it its my of on or so that the this to was what when where which who why will with you your we our they them their there then than but not no into out up about'.split(' '));

import { stem } from './stem.mjs';

export const tokenize = (text, { stemming = false } = {}) => {
  const tokens = (text.toLowerCase().match(/[a-z0-9_]+/g) || []).filter(t => t.length > 1 && !STOP.has(t));
  return stemming ? tokens.map(stem) : tokens;
};

/** Okapi BM25 over chunks. search() returns [{ chunk, score }] best first. */
export function buildBm25(chunks, { k1 = 1.2, b = 0.75, stemming = false } = {}) {
  const docs = chunks.map(chunk => { const tokens = tokenize(chunk.text, { stemming }); const tf = new Map(); for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1); return { chunk, tf, len: tokens.length }; });
  const avgLen = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  const df = new Map();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const N = docs.length;
  const idf = t => Math.log(1 + (N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5));
  return {
    search(query, k = 10) {
      const terms = [...new Set(tokenize(query, { stemming }))];
      const scored = docs.map(d => {
        let score = 0;
        for (const t of terms) { const f = d.tf.get(t); if (f) score += idf(t) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / avgLen)); }
        return { chunk: d.chunk, score };
      });
      return scored.filter(s => s.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
    },
  };
}

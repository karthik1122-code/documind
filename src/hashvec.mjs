import { tokenize } from './bm25.mjs';

/**
 * Hashed n-gram vectors: words, word pairs and character trigrams hashed into a fixed number of
 * buckets. Tolerant to typos and word forms, but it knows nothing about meaning, so "hang" and
 * "stuck" are unrelated. Included as a cheap, honest baseline for dense retrieval.
 */
const fnv = s => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

export function embedHash(text, dim = 1024) {
  const v = new Float64Array(dim);
  const add = (feature, w) => { const h = fnv(feature); v[h % dim] += (h & 0x80000000 ? -1 : 1) * w; };
  const words = tokenize(text);
  words.forEach((w, i) => {
    add(`w:${w}`, 1);
    if (i > 0) add(`b:${words[i - 1]}_${w}`, 0.7);
    const padded = `^${w}$`;
    for (let j = 0; j + 3 <= padded.length; j += 1) add(`c:${padded.slice(j, j + 3)}`, 0.3);
  });
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map(x => x / norm);
}

export function buildHashIndex(chunks, { dim = 1024 } = {}) {
  const vecs = chunks.map(c => embedHash(c.text, dim));
  return {
    search(query, k = 10) {
      const q = embedHash(query, dim);
      return chunks.map((chunk, i) => { let s = 0; for (let d = 0; d < dim; d += 1) s += q[d] * vecs[i][d]; return { chunk, score: s }; }).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

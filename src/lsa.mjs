import { tokenize } from './bm25.mjs';

/**
 * Latent semantic analysis: a small, fully local "embedding" learned from the chunks themselves.
 * Terms that co-occur across chunks end up near each other, so a query can reach a chunk that
 * shares no exact words with it. No labels or questions are used to fit it.
 *
 *   X  = tf-idf matrix (chunks x terms), rows L2-normalised
 *   XX^T = U S^2 U^T  (eigen-decomposition, Jacobi)
 *   chunk vector = U_k S_k        query vector = S_k^-1 U_k^T (X q)
 */
export function buildLsa(chunks, { dim = 50, stemming = true } = {}) {
  const n = chunks.length;
  const docsTokens = chunks.map(c => tokenize(c.text, { stemming }));
  const df = new Map();
  for (const toks of docsTokens) for (const t of new Set(toks)) df.set(t, (df.get(t) || 0) + 1);
  const idf = t => Math.log((n + 1) / ((df.get(t) || 0) + 1)) + 1;

  const weigh = tokens => {
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    const row = new Map();
    let norm = 0;
    for (const [t, f] of tf) { if (!df.has(t)) continue; const w = (1 + Math.log(f)) * idf(t); row.set(t, w); norm += w * w; }
    norm = Math.sqrt(norm) || 1;
    for (const [t, w] of row) row.set(t, w / norm);
    return row;
  };
  const dot = (a, b) => { let s = 0; const [small, big] = a.size < b.size ? [a, b] : [b, a]; for (const [t, w] of small) { const v = big.get(t); if (v) s += w * v; } return s; };

  const rows = docsTokens.map(weigh);
  const G = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i += 1) for (let j = i; j < n; j += 1) { const v = dot(rows[i], rows[j]); G[i][j] = v; G[j][i] = v; }
  const { values, vectors } = jacobiEigen(G);

  const order = values.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).filter(([v]) => v > 1e-9).slice(0, Math.min(dim, n - 1));
  const k = order.length;
  const sigma = order.map(([v]) => Math.sqrt(v));
  const docVecs = rows.map((_, i) => normalise(order.map(([, col], d) => vectors[i][col] * sigma[d])));

  const project = query => {
    const q = weigh(tokenize(query, { stemming }));
    if (!q.size) return null;
    const s = rows.map(r => dot(r, q)); // X q
    return normalise(order.map(([, col], d) => { let acc = 0; for (let i = 0; i < n; i += 1) acc += vectors[i][col] * s[i]; return acc / sigma[d]; }));
  };

  return {
    dim: k,
    search(query, topK = 10) {
      const q = project(query);
      if (!q) return [];
      return chunks.map((chunk, i) => ({ chunk, score: cosine(q, docVecs[i]) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
    },
  };
}

const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };
const normalise = v => { const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1; return v.map(x => x / n); };

/** Cyclic Jacobi for a real symmetric matrix. Returns eigenvalues and column eigenvectors. */
export function jacobiEigen(matrix, { maxSweeps = 60, tol = 1e-12 } = {}) {
  const n = matrix.length;
  const a = matrix.map(r => Float64Array.from(r));
  const v = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = 1; return r; });
  for (let sweep = 0; sweep < maxSweeps; sweep += 1) {
    let off = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) off += a[p][q] * a[p][q];
    if (off < tol) break;
    for (let p = 0; p < n - 1; p += 1) for (let q = p + 1; q < n; q += 1) {
      if (Math.abs(a[p][q]) < 1e-15) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k += 1) { const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k += 1) { const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k += 1) { const vkp = v[k][p], vkq = v[k][q]; v[k][p] = c * vkp - s * vkq; v[k][q] = s * vkp + c * vkq; }
    }
  }
  return { values: Array.from({ length: n }, (_, i) => a[i][i]), vectors: v };
}

import { norm } from './corpus.mjs';

/** A retrieved chunk is relevant if it contains any of the question's evidence phrases. */
export const isRelevant = (chunk, evidence) => { const t = norm(chunk.text); return evidence.some(e => t.includes(norm(e))); };

export function scoreRetriever(search, questions, ks = [1, 3, 5]) {
  const answerable = questions.filter(q => q.type !== 'unanswerable');
  const rows = answerable.map(q => {
    const results = search(q.question, Math.max(...ks));
    const rank = results.findIndex(r => isRelevant(r.chunk, q.evidence));
    const ctx3 = results.slice(0, 3).reduce((s, r) => s + r.chunk.text.length, 0);
    return { id: q.id, type: q.type, rank: rank === -1 ? null : rank + 1, top: results[0]?.score ?? 0, ctx3 };
  });
  const recall = Object.fromEntries(ks.map(k => [`recall@${k}`, +(rows.filter(r => r.rank && r.rank <= k).length / rows.length).toFixed(3)]));
  const contextChars3 = Math.round(rows.reduce((s, r) => s + r.ctx3, 0) / rows.length);
  const mrr = +(rows.reduce((s, r) => s + (r.rank ? 1 / r.rank : 0), 0) / rows.length).toFixed(3);
  const byType = {};
  for (const type of [...new Set(rows.map(r => r.type))]) {
    const sub = rows.filter(r => r.type === type);
    byType[type] = { n: sub.length, 'recall@3': +(sub.filter(r => r.rank && r.rank <= 3).length / sub.length).toFixed(3) };
  }
  const unanswerableTop = questions.filter(q => q.type === 'unanswerable').map(q => ({ id: q.id, top: +(search(q.question, 1)[0]?.score ?? 0).toFixed(2) }));
  return { n: rows.length, ...recall, mrr, contextChars3, byType, misses: rows.filter(r => !r.rank || r.rank > 5).map(r => r.id), rows, unanswerableTop };
}

/** Reciprocal rank fusion: score = sum over retrievers of 1 / (c + rank). c = 60 is the usual default. */
export function rrf(searchers, { c = 60, depth = 50 } = {}) {
  return {
    search(query, k = 10) {
      const fused = new Map();
      for (const s of searchers) {
        s.search(query, depth).forEach((r, i) => {
          const entry = fused.get(r.chunk.id) || { chunk: r.chunk, score: 0 };
          entry.score += 1 / (c + i + 1);
          fused.set(r.chunk.id, entry);
        });
      }
      return [...fused.values()].sort((a, b) => b.score - a.score).slice(0, k);
    },
  };
}

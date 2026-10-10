import { loadCorpus } from './corpus.mjs';
import { chunkSections } from './chunk.mjs';
import { buildBm25 } from './bm25.mjs';
import { buildLsa } from './lsa.mjs';
import { rrf } from './hybrid.mjs';
import { buildReranker } from './rerank.mjs';
import { buildAnswerer, buildPrompt, parseLlmReply } from './answer.mjs';

/** Retrieval: sections of at most 800 chars -> BM25 (stemmed) + LSA fused with RRF -> feature reranker. */
export function createPipeline({ corpusDir, docs: given, llm = null, topK = 5, maxChunks = Infinity } = {}) {
  const docs = given || loadCorpus(corpusDir);
  const chunks = chunkSections(docs, { maxChars: 800 });
  if (!chunks.length) throw Object.assign(new Error('no readable text in these documents'), { code: 'empty' });
  if (chunks.length > maxChunks) throw Object.assign(new Error(`these documents split into ${chunks.length} passages; the limit is ${maxChunks}`), { code: 'too_many_chunks' });
  const retriever = buildReranker(rrf([buildBm25(chunks, { stemming: true }), buildLsa(chunks, { dim: 50 })]), chunks);
  // Settings chosen on the dev half of the evaluation set (see eval/results/answer-eval.md).
  const extractive = buildAnswerer(chunks, { threshold: 0.5, oovMax: 0.15 });

  const view = r => ({ id: r.chunk.id, file: r.chunk.file, heading: r.chunk.heading, text: r.chunk.text, score: +r.score.toFixed(3) });

  return {
    mode: llm ? llm.name : 'extractive',
    docCount: docs.length,
    chunkCount: chunks.length,
    docs: docs.map(d => d.file),
    retrieve: question => retriever.search(question, topK),
    /** Yields { type: 'sources' | 'delta' | 'answer', ... } events. */
    async *ask(question) {
      const results = retriever.search(question, topK);
      yield { type: 'sources', sources: results.map(view) };
      if (!llm) {
        const a = extractive.answer(question, results);
        yield { type: 'answer', ...a, mode: 'extractive' };
        return;
      }
      const { system, user, passages } = buildPrompt(question, results);
      let text = '';
      for await (const piece of llm.stream({ system, user })) { text += piece; yield { type: 'delta', text: piece }; }
      yield { type: 'answer', ...parseLlmReply(text, passages), mode: llm.name };
    },
  };
}

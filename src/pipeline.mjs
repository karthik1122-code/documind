import { loadCorpus } from './corpus.mjs';
import { chunkSections } from './chunk.mjs';
import { buildBm25 } from './bm25.mjs';
import { buildLsa } from './lsa.mjs';
import { rrf } from './hybrid.mjs';
import { buildReranker } from './rerank.mjs';
import { buildAnswerer, buildPrompt, parseLlmReply } from './answer.mjs';

/** Retrieval: sections of at most 800 chars -> BM25 (stemmed) + LSA fused with RRF -> feature reranker. */
export function createPipeline({ corpusDir, docs: given, llm = null, topK = 5, maxChunks = Infinity, llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS || 25_000) } = {}) {
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
    /** Full text of one indexed document, for the source reader. Null when the file is not in this pipeline. */
    doc: file => { const d = docs.find(x => x.file === file); return d ? { file: d.file, text: d.text } : null; },
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
      // If the model is busy, slow or fails mid-answer, fall back to the extractive answer instead of an error:
      // the user still gets a cited sentence copied from the source, or a refusal.
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(new Error('timeout')), llmTimeoutMs);
      let text = '';
      try {
        for await (const piece of llm.stream({ system, user, signal: timeout.signal })) { text += piece; yield { type: 'delta', text: piece }; }
        yield { type: 'answer', ...parseLlmReply(text, passages), mode: llm.name };
      } catch (error) {
        console.warn(`LLM failed (${error.status || error.message}); using the extractive answer.`);
        const why = timeout.signal.aborted ? 'The AI model took too long' : text ? 'The AI model stopped mid-answer' : 'The AI model is unavailable right now';
        yield { type: 'answer', ...extractive.answer(question, results), mode: 'extractive', note: `${why}, so this answer is copied from the source instead.` };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

# DocuMind

Question answering over documentation, built **evaluation-first**: the question set and the metrics exist before the pipeline, so every design choice is measured instead of guessed.

**Status:** retrieval evaluation harness and BM25 baseline are done. Embeddings, hybrid search, reranking, the answer step and the chat UI are next (see the roadmap).

## The corpus

The 16 English pages of the Express 5 guide, starter and advanced docs, copied unchanged into `corpus/`. They are published by the Express project under [CC BY 4.0](corpus/LICENSE.md) (source: github.com/expressjs/expressjs.com). This project is not affiliated with or endorsed by Express.

## The evaluation set

`eval/questions.json` has 40 hand-written questions:

| Type | Count | What it tests |
|---|---|---|
| lookup | 22 | wording close to the docs |
| paraphrase | 11 | different words than the docs ("my handler is ignored" vs "four arguments") |
| multi-doc | 2 | the answer appears in more than one page |
| unanswerable | 5 | the docs do not cover it, so the right answer is "I don't know" |

Every answerable question has an **evidence phrase** copied from the corpus. A retrieved chunk counts as relevant if it contains that phrase. `npm run verify:questions` checks that every phrase really exists, and it runs in `npm test`. Because relevance is judged on text and not on chunk ids, different chunking strategies can be compared fairly.

The questions were written by the author, so this is a small, controlled benchmark. It is not a claim about performance on other documentation.

## Results: BM25 baseline (keyword search only)

`npm run eval` reproduces this table. Numbers are over the 35 answerable questions.

| Chunking | Chunks | recall@1 | recall@3 | recall@5 | MRR | Context at k=3 (chars) |
|---|---|---|---|---|---|---|
| fixed 400 | 358 | 40.0% | 57.1% | 65.7% | 0.49 | 1158 |
| fixed 800 | 175 | 51.4% | 74.3% | 82.9% | 0.64 | 2311 |
| fixed 1600 | 90 | 62.9% | 91.4% | 94.3% | 0.755 | 4575 |
| sections 800 | 198 | 65.7% | 80.0% | 88.6% | 0.739 | 2229 |
| sections 1600 | 114 | 68.6% | 80.0% | 94.3% | 0.776 | 3494 |

What this shows:

1. **Bigger chunks look better but cost more.** Recall rises with chunk size because a larger chunk is more likely to contain the evidence. The last column shows what that costs: fixed 1600 hands the model about 4.6K characters per question, four times the 400-character setting.
2. **Structure-aware chunking wins at equal cost.** At about 2.2K characters of context, sections 800 beats fixed 800 on recall@1 (65.7% vs 51.4%) and recall@3 (80.0% vs 74.3%). Splitting on headings, and prefixing each chunk with its page title and heading, keeps an answer in one piece.
3. **Paraphrased questions are the weak spot for keyword search.** In the best configuration (fixed 1600) two questions, q01 and q23, are still missed at k=5, and both reword the docs heavily. This is what embeddings and hybrid search are meant to fix, and the next step measures whether they do.
4. **A score threshold cannot reliably tell "not covered" from "covered".** In that same configuration the highest BM25 score on an unanswerable question (9.1) is higher than the lowest on an answerable one (6.2), because words like "express" and "Redis" still match. Deciding when to abstain needs the answer step plus its own evaluation.

## Roadmap

- [x] Corpus, 40-question evaluation set with verified evidence, metrics
- [x] Chunking strategies and BM25 baseline
- [ ] Embeddings + pgvector, compared against BM25
- [ ] Hybrid search (reciprocal rank fusion) and a reranker, each with a before/after row
- [ ] Answer generation with citations, scored for faithfulness and for abstaining on the 5 unanswerable questions
- [ ] Streaming chat UI (Next.js, Vercel AI SDK) with citations linking to the source chunk
- [ ] Prompt-injection tests for documents that contain instructions

## Run it

Requires Node 22 or newer. No dependencies yet.

```bash
npm test          # unit tests + evidence verification
npm run eval      # print the results table
npm run eval:write  # also save eval/results/bm25-baseline.json
```

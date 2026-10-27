# DocuMind

Question answering over documentation, built **evaluation-first**: the question set and the metrics came before the pipeline, so every design choice is measured instead of guessed. Answers cite their source passage, and questions the docs do not cover are refused.

**What it is:** a retrieval pipeline (chunking, keyword search, a local semantic index, rank fusion, a reranker), an answer step with abstention, a streaming chat UI, and the evaluation harness that decided each part.
**What it is not (yet):** a model-generated answer system measured end to end. That needs a model key; the scripts are written and tested with mocks, and the numbers are marked pending below.

## Quick start

Requires Node 22 or newer. No runtime dependencies (Playwright is a dev dependency for the browser test only).

```bash
npm test            # 35 tests, including the evaluation gates
npm run test:e2e    # browser journey: ask, refusal, paste your own document, phone layout
npm start           # http://localhost:4180 (extractive mode, no key needed)
GEMINI_API_KEY=... npm start   # generates answers from retrieved passages only
```

## Ask your own documents

The **Your documents** tab indexes up to 8 `.md`, `.mdx` or `.txt` files (150 KB in total, at most 300 passages) with the same pipeline, then answers from them with the same citations and refusals. Uploads live in server memory for one hour behind a random 128-bit id, are never written to disk, and can be removed at any time. Do not upload confidential text to a public demo.

Caveat that matters: the refusal thresholds were tuned on the Express docs. On other documents the answerer may refuse too often or too rarely, and I have not measured it. One fix came from testing this tab: everyday question words such as "many" or "get" used to count as unknown terms, so a small document refused plain questions like "How many days of annual leave do employees get?". They are now ignored by the unknown-word check; the Express numbers below are unchanged by this. Tested: indexing, a cited answer, a refusal, expiry and removal, bad file types, empty and oversized uploads.

## The corpus and the question set

The 16 English pages of the Express 5 guide, starter and advanced docs, copied unchanged into `corpus/`. Published by the Express project under [CC BY 4.0](corpus/LICENSE.md) (source: github.com/expressjs/expressjs.com). Not affiliated with or endorsed by Express.

`eval/questions.json` has 50 hand-written questions:

| Type | Count | What it tests |
|---|---|---|
| lookup | 22 | wording close to the docs |
| paraphrase | 11 | different words than the docs ("my handler is ignored" vs "four arguments") |
| multi-doc | 2 | the answer appears on more than one page |
| unanswerable | 15 | the docs do not cover it, so the right reply is a refusal (some are near-misses, e.g. the docs mention Redis, gzip middleware and cookies, but never answer these) |

Every answerable question carries an **evidence phrase** copied from the corpus. A retrieved chunk is relevant if it contains the phrase, so different chunkings are compared fairly. `eval/verify-questions.mjs` checks that every phrase exists, and it runs in `npm test`.

**Limits:** the questions were written by the author for one corpus. With 35 answerable questions, one question is worth 2.9 percentage points, so small differences below are noise. This is a controlled benchmark, not a claim about other documentation.

## Results

### 1. Chunking (keyword search only)

Bigger chunks look better because they simply contain more text, so the table also shows the cost: characters handed to the model per question.

| Chunking | Chunks | recall@1 | recall@3 | recall@5 | MRR | Context at k=3 (chars) |
|---|---|---|---|---|---|---|
| fixed 400 | 358 | 40.0% | 57.1% | 65.7% | 0.49 | 1158 |
| fixed 800 | 175 | 51.4% | 74.3% | 82.9% | 0.64 | 2311 |
| fixed 1600 | 90 | 62.9% | 91.4% | 94.3% | 0.755 | 4575 |
| sections 800 | 198 | 65.7% | 80.0% | 88.6% | 0.739 | 2229 |
| sections 1600 | 114 | 68.6% | 80.0% | 94.3% | 0.776 | 3494 |

At about 2.2K characters of context, splitting at headings (and prefixing each chunk with its page title and heading) beats fixed windows on recall@1 (65.7% vs 51.4%) and recall@3 (80.0% vs 74.3%). The pipeline uses **sections 800**.

### 2. Retrieval methods (sections 800)

All settings are standard defaults chosen before looking at results (BM25 k1=1.2 b=0.75, RRF c=60, LSA 50 dimensions, fixed reranker weights). Nothing was tuned on the questions. `npm run eval:ablation` reproduces it, and `eval/results/ablation.md` also has sections 1600.

| Method | recall@1 | recall@3 | recall@5 | MRR | paraphrase recall@3 | Misses at k=5 |
|---|---|---|---|---|---|---|
| BM25 | 65.7% | 80.0% | 88.6% | 0.739 | 72.7% | q01, q06, q14, q23 |
| BM25 + stemming | 65.7% | 82.9% | 91.4% | 0.758 | 63.6% | q01, q23, q25 |
| Hashed n-gram vectors | 40.0% | 62.9% | 77.1% | 0.538 | 45.5% | q01, q02, q17, q18, q23, q26, q27, q30 |
| LSA (50 dims) | 54.3% | 74.3% | 88.6% | 0.663 | 54.5% | q01, q23, q30, q35 |
| Hybrid: BM25s + LSA (RRF) | 57.1% | 82.9% | 94.3% | 0.714 | 63.6% | q01, q23 |
| Hybrid: BM25s + LSA + hash (RRF) | 60.0% | 82.9% | 91.4% | 0.703 | 63.6% | q01, q23, q26 |
| BM25s + reranker | 68.6% | 85.7% | 91.4% | 0.769 | 54.5% | q01, q23, q25 |
| Hybrid BM25s + LSA + reranker | 71.4% | 85.7% | 91.4% | 0.784 | 54.5% | q01, q23, q25 |

What the table says, without over-reading it:

- **Hybrid helps recall at depth.** BM25 + stemming + LSA fused with RRF reaches 94.3% recall@5 versus 88.6% for plain BM25.
- **The reranker helps the top spot.** Adding it gives the best recall@1 (71.4%) and MRR (0.784).
- **The cheap "embedding" baselines are not magic.** Hashed n-gram vectors are worse than BM25. LSA alone is about the same as BM25 at k=5.
- **The hard paraphrases stay hard.** q01 and q23 are missed by every local method because they share almost no words with the answer. That is the case for a neural embedding model, and `npm run eval:gemini` adds those rows once a key is available.
- **Differences of one or two questions are noise** at this sample size.

### 3. Answering and refusing (no model key)

The default mode copies the best-matching sentence and refuses when coverage is too low or the question uses words that never appear in the docs. The refusal setting was chosen on the first half of the questions and is reported on the second half, which was not used to choose it.

**Held-out half:**

| Min coverage | Max unknown-word share | Answerable answered correctly | Answered wrongly | Unanswerable refused | False answers | Balanced accuracy |
|---|---|---|---|---|---|---|
| 0.5 | 0.15 | 24% | 1 | 100% | 0 | 62% |

**All 50 questions:**

| Min coverage | Max unknown-word share | Answerable answered correctly | Answered wrongly | Unanswerable refused | False answers | Balanced accuracy |
|---|---|---|---|---|---|---|
| 0.5 | 0.15 | 29% | 4 | 100% | 0 | 64% |

Summary: the extractive mode **never answered an uncovered question** on the 15 unanswerable questions, but it **answers under a third of the answerable ones correctly**. It is safe and conservative, not smart. Sentence matching cannot bridge paraphrases, which is exactly what a generated answer is for. `npm test` fails if it ever answers an unanswerable question.

### 4. Model-generated answers (pending)

`npm run eval:llm` scores a model answering from the retrieved passages only, with citations: correctness, refusal on the 15 unanswerable questions, citation of the right passage, and 18 prompt-injection attempts (instructions hidden inside retrieved passages). The Gemini adapter (`src/providers.mjs`) is covered by unit tests against a mocked server, including header-only key handling, batching and stream parsing, but **has not been run against the live service**. No numbers are claimed until it has.

## How it works

```
question
  -> BM25 (stemmed)  ┐
                     ├-> reciprocal rank fusion -> feature reranker -> top 5 passages
  -> LSA (local)     ┘
  -> answer step:  extractive (default)  |  model, from passages only, with [n] citations
  -> refuse when: unknown words, weak coverage, model says NOT_IN_DOCS, or reply has no valid citation
```

- **Prompt-injection posture:** retrieved passages are wrapped in delimiters, any delimiter text inside a passage is neutralised, the system prompt says passages are data and never instructions, and replies without a citation to a supplied passage are discarded. These are unit-tested. Whether a given model resists is what `eval:llm` measures.
- **When the model fails:** the Gemini adapter retries 503 and 429 answers with backoff, then tries `GEMINI_FALLBACK_MODEL` if set. A call that takes longer than `LLM_TIMEOUT_MS` (default 25 s) is cut off. If the model still fails, or stops mid-answer, the user gets the extractive answer, a sentence copied from the source with its citation (or a refusal), with a note saying why, never a bare error. Covered by unit tests with a mocked model.
- **Server:** request bodies are capped, questions are limited to 400 characters, an in-memory limiter allows 20 questions a minute per address (behind Render's proxy set `TRUST_PROXY=true`, which `render.yaml` does), only `public/` is served, and a strict content security policy is set.

## Layout

```
corpus/            the 16 Express 5 pages + licence
eval/              questions, verification, retrieval + answer evaluations, results/
src/               chunk, bm25, stem, lsa, hashvec, hybrid, rerank, answer, providers, pipeline
public/            the chat UI
server.mjs         streaming API (server-sent events) + static files
```

## Deploying

The live demo runs on Vercel (below). `render.yaml` and a `Dockerfile` are included as an alternative and have not been deployed. `GEMINI_API_KEY` is optional and must be set in the host's environment, never committed.

| Variable | Needed | Purpose |
| --- | --- | --- |
| `GEMINI_API_KEY` | no | Turns on model-written answers; without it answers are extractive |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODEL` | no | Main model (default `gemini-3.8-flash`) and the one tried when it is overloaded |
| `LLM_TIMEOUT_MS` | no | Cut-off for one model answer (default 25000) |
| `RATE_LIMIT` | no | Questions per minute per address (default 20) |
| `TRUST_PROXY` | behind a proxy | Read the visitor address from `X-Forwarded-For` |

## Roadmap

- [x] Corpus, 50-question evaluation set with verified evidence, metrics
- [x] Chunking study, BM25 baseline, local semantic index, hybrid fusion, reranker
- [x] Answer step with abstention, held-out evaluation, regression gates
- [x] Streaming chat UI with citations
- [ ] Neural embeddings (needs a model key): `npm run eval:gemini`
- [ ] Model-generated answers and injection results: `npm run eval:llm`
- [x] Deploy (Vercel)

## Deploy (Vercel)

The whole site is one codebase: `/` is the landing page, `/app` is the app, and `api/*.mjs` re-export the same request handler `server.mjs` uses, so the Vercel deployment runs the real retrieval pipeline and the real upload flow. `vercel.json` serves `public/`, bundles `corpus/` and `src/` into the functions, and sets the security headers. Import the repository in Vercel and keep the defaults; no environment variables are needed. Set `GEMINI_API_KEY` to turn on model-written answers.

On Vercel each function instance is separate and short-lived, so uploaded collections are rebuilt from the files the browser sends again, and the rate limiter is per instance (best effort). `render.yaml` and the `Dockerfile` run the same code as one long-lived server, which is the simpler option if you want one shared limiter.
